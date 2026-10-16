// lineart-regions.js — krok „lineart → plochy“ (prototyp).
//
// Z čiernobielej kresby (SVG alebo PNG/JPG) spočíta vyfarbiteľné plochy tak,
// ako ich dnes ručne robí vedierko v Inkscape, ale naraz pre celú kresbu:
//
//   1) kresbu vykreslí do rastra (predvolene 2048 px), vycentruje a zväčší ju
//      na plátno 1024 × 1024 s okrajom
//   2) čiara = pixel tmavší ako prah; medzery v čiarach užšie ako ~2·gap px
//      sa pri hľadaní plôch považujú za zatvorené
//   3) súvislé biele oblasti = plochy; tie, čo sa dotýkajú okraja, sú pozadie;
//      drobné plôšky (napr. odlesk v oku) ostanú biele a nie sú plochou
//   4) každá plocha sa „rozleje“ pod čiaru (grow px), aby po vyfarbení
//      nezostala medzi farbou a čiarou biela škára
//   5) plochy aj čiary sa obtiahnu na krivky
//
// Výstup je medzistupeň v rovnakom tvare, aký dnes vznikne ručne v Inkscape,
// takže ďalej ide cez preprocessor.js bez zmeny:
//   plochy  <path id="r-01" style="fill:#ff0000" …/>      → data-region, fill #ffffff
//   čiary   <path fill="#1a1a1a" data-locked="true" …/>    (bez style, preprocesor ich nechá)
//
// Plochy sa navzájom neprekrývajú (každý pixel patrí najviac jednej), preto
// nevznikajú skryté biele kópie regiónov, ktoré rieši region-overlap.js.

(function () {
  'use strict';

  const DEFAULTS = {
    size: 2048,        // rozlíšenie rastra v px pre plátno 1024 jednotiek
    margin: 40,        // okraj okolo kresby v jednotkách viewBox
    threshold: 128,    // jas (0–255), pod ktorým je pixel čiara
    gap: 2,            // polomer uzatvárania medzier v čiarach (px rastra)
    grow: 10,          // ako ďaleko plocha zalezie pod čiaru (px rastra)
    extend: 40,        // voľný koniec čiary sa predĺži najviac o toľko px rastra (0 = vypnuté)
    extendBack: 12,    // z koľkých px kostry sa berie smer konca čiary
    extendSpur: 10,    // kratšia vetva kostry je výbežok, nie koniec čiary
    extendRatio: 0.12, // predĺženie najviac taká časť dĺžky ťahu (úsmev, písmená pri ráme sa nepredlžujú)
    minSplit: 2400,    // predĺženie môže oddeliť len plochu aspoň takú veľkú (px² rastra)
    minRegion: 64,     // menšie biele plôšky (px² rastra) ostanú biele, nie sú plochou
    minInk: 6,         // menšie čierne škvrny (px² rastra) sa zahodia ako šum
    simplify: 0.6,     // tolerancia zjednodušenia čiar (px rastra)
    simplifyRegion: 1.2, // tolerancia pre plochy — ich okraj je schovaný pod čiarou
    corner: 70,        // zlom nad týmto uhlom (°) ostane ostrý
  };

  const VB = 1024;

  // ───────────────────────── načítanie a raster ─────────────────────────

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Obrázok sa nedá načítať.')); };
      img.src = url;
    });
  }

  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    return { c, ctx };
  }

  function toGray(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
    }
    return g;
  }

  function parseViewBox(svg) {
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0) return vb;
    const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
    if (w > 0 && h > 0) return [0, 0, w, h];
    return [0, 0, VB, VB];
  }

  // Vykreslí SVG text tak, aby štvorec box (v súradniciach zdroja) vyplnil S × S px.
  async function renderSvgBox(text, box, S) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('Súbor nie je SVG.');
    svg.setAttribute('viewBox', box.join(' '));
    svg.setAttribute('width', S);
    svg.setAttribute('height', S);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    const { img, url } = await loadImage(blob);
    const { ctx } = newCanvas(S, S);
    ctx.drawImage(img, 0, 0, S, S);
    URL.revokeObjectURL(url);
    return toGray(ctx, S, S);
  }

  function inkBBox(gray, W, H, T) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (gray[row + x] < T) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }

  // štvorec okolo obdĺžnika tak, aby po zmenšení na VB zostal okraj margin
  function squareAround(x, y, w, h, margin) {
    const side = Math.max(w, h) / (1 - 2 * margin / VB);
    return [x + w / 2 - side / 2, y + h / 2 - side / 2, side, side];
  }

  // Vráti { gray, S } — kresba vycentrovaná a zväčšená na S × S px.
  async function rasterize(input, o) {
    const S = o.size;
    const isSvg = typeof input === 'string' ||
      (input && (input.type === 'image/svg+xml' || /\.svg$/i.test(input.name || '')));

    if (isSvg) {
      const text = typeof input === 'string' ? input : await input.text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const vb = parseViewBox(doc.documentElement);
      // 1. priechod: celý viewBox (doplnený na štvorec), nájdi kresbu
      const P = 1024;
      const box1 = squareAround(vb[0], vb[1], vb[2], vb[3], 0);
      const g1 = await renderSvgBox(text, box1, P);
      const bb = inkBBox(g1, P, P, o.threshold);
      if (!bb) throw new Error('Kresba je prázdna (žiadny tmavý pixel).');
      const k = box1[2] / P;
      const box2 = squareAround(box1[0] + (bb.x0 - 1) * k, box1[1] + (bb.y0 - 1) * k,
        (bb.x1 - bb.x0 + 2) * k, (bb.y1 - bb.y0 + 2) * k, o.margin);
      // 2. priechod: vektorovo ostro priamo vo výslednom rozlíšení
      return { gray: await renderSvgBox(text, box2, S), S, box: box2 };
    }

    // bitmapa
    const { img, url } = await loadImage(input);
    const w = img.naturalWidth, h = img.naturalHeight;
    const a = newCanvas(w, h);
    a.ctx.drawImage(img, 0, 0);
    const bb = inkBBox(toGray(a.ctx, w, h), w, h, o.threshold);
    if (!bb) { URL.revokeObjectURL(url); throw new Error('Kresba je prázdna (žiadny tmavý pixel).'); }
    const box = squareAround(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0, o.margin);
    const b = newCanvas(S, S);
    const s = S / box[2];
    b.ctx.imageSmoothingQuality = 'high';
    b.ctx.setTransform(s, 0, 0, s, -box[0] * s, -box[1] * s);
    b.ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    return { gray: toGray(b.ctx, S, S), S, box };
  }

  // ───────────────────────── plochy ─────────────────────────

  function dilate(src, S, conn8) {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        if (src[i]) { out[i] = 1; continue; }
        const l = x > 0, r = x < S - 1, u = y > 0, d = y < S - 1;
        if ((l && src[i - 1]) || (r && src[i + 1]) || (u && src[i - S]) || (d && src[i + S]) ||
            (conn8 && ((u && l && src[i - S - 1]) || (u && r && src[i - S + 1]) ||
                       (d && l && src[i + S - 1]) || (d && r && src[i + S + 1])))) out[i] = 1;
      }
    }
    return out;
  }

  const BG = 1;          // pozadie
  const BLOCKED = -1;    // drobná biela plôška, ostáva biela

  // súvislé oblasti voľných pixelov (4-susednosť); tmp = dočasné id, comps[id] = { area, border }
  function labelFree(wall, S, stack) {
    const N = S * S;
    const tmp = new Int32Array(N);
    const comps = [null];
    for (let start = 0; start < N; start++) {
      if (wall[start] || tmp[start]) continue;
      const id = comps.length;
      let sp = 0, area = 0, border = false;
      stack[sp++] = start; tmp[start] = id;
      while (sp) {
        const i = stack[--sp];
        area++;
        const x = i % S, y = (i - x) / S;
        if (x === 0 || y === 0 || x === S - 1 || y === S - 1) border = true;
        if (x > 0 && !wall[i - 1] && !tmp[i - 1]) { tmp[i - 1] = id; stack[sp++] = i - 1; }
        if (x < S - 1 && !wall[i + 1] && !tmp[i + 1]) { tmp[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && !wall[i - S] && !tmp[i - S]) { tmp[i - S] = id; stack[sp++] = i - S; }
        if (y < S - 1 && !wall[i + S] && !tmp[i + S]) { tmp[i + S] = id; stack[sp++] = i + S; }
      }
      comps.push({ area, border });
    }
    return { tmp, comps };
  }

  // ── predĺženie voľných koncov čiar
  //
  // Čiara, ktorá sa nedotiahne k inej čiare (napr. okraj vlasov pri uchu), nechá
  // medzeru dlhšiu, než zatvorí `gap`, a dve plochy splynú. Z čiar sa spraví kostra
  // (Zhang–Suen), nájdu sa jej voľné konce a od každého ide lúč v smere čiary.
  // Ak do `extend` px narazí na čiaru, úsečka sa pridá do steny — len pri hľadaní
  // plôch, viditeľná kresba ostáva bez zmeny.

  function thin(src, S, x0, y0, x1, y1) {
    const img = src.slice();
    const del = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const i = y * S + x;
            if (!img[i]) continue;
            const p2 = img[i - S], p3 = img[i - S + 1], p4 = img[i + 1], p5 = img[i + S + 1],
                  p6 = img[i + S], p7 = img[i + S - 1], p8 = img[i - 1], p9 = img[i - S - 1];
            const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;
            const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) +
                      (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
            if (A !== 1) continue;
            if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
            del.push(i);
          }
        }
        for (const i of del) img[i] = 0;
        if (del.length) changed = true;
      }
    }
    return img;
  }

  const NB8 = (S) => [-S - 1, -S, -S + 1, -1, 1, S - 1, S, S + 1];

  // Súvislé časti čiar (8-susednosť) a dĺžka kostry každej z nich v px.
  // Predĺženie smie byť len malým zlomkom ťahu: dlhý okraj vlasov, ktorý sa o kúsok
  // nedotiahne k uchu, áno; krátky úsmev, ktorého konce sú blízko líc, nie.
  function strokeComponents(ink, sk, S) {
    const N = S * S;
    const inkId = new Int32Array(N);
    const stack = [];
    let n = 0;
    for (let s = 0; s < N; s++) {
      if (!ink[s] || inkId[s]) continue;
      n++; inkId[s] = n; stack.push(s);
      while (stack.length) {
        const i = stack.pop(), x = i % S;
        for (const j of [i - S - 1, i - S, i - S + 1, i - 1, i + 1, i + S - 1, i + S, i + S + 1]) {
          if (j < 0 || j >= N || Math.abs((j % S) - x) > 1) continue;
          if (ink[j] && !inkId[j]) { inkId[j] = n; stack.push(j); }
        }
      }
    }
    const len = new Float64Array(n + 1);
    for (let i = 0; i < N; i++) if (sk[i]) len[inkId[i]]++;
    return { inkId, len };
  }

  function extendEnds(ink, S, o) {
    // obal čiar s okrajom 2 px (kostra potrebuje susedov)
    let x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (let i = 0; i < ink.length; i++) if (ink[i]) {
      const x = i % S, y = (i - x) / S;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const ext = new Uint8Array(ink.length);
    const segs = [];
    const info = { ends: 0, short: 0 };
    if (x1 < 0) return { ext, segs, info };
    x0 = Math.max(2, x0 - 2); y0 = Math.max(2, y0 - 2); x1 = Math.min(S - 3, x1 + 2); y1 = Math.min(S - 3, y1 + 2);
    const sk = thin(ink, S, x0, y0, x1, y1);
    const comp = strokeComponents(ink, sk, S);
    const nb = NB8(S);
    const deg = (i) => { let n = 0; for (const d of nb) n += sk[i + d]; return n; };
    const inside = (x, y) => x >= 0 && y >= 0 && x < S && y < S;
    const XY = (i) => [i % S, Math.floor(i / S)];

    // prejde kostru od `start` (prišli sme z `from`), kým nenarazí na uzol, koniec alebo max krokov
    const walk = (from, start, max) => {
      const path = [start];
      let prev = from, cur = start;
      while (path.length <= max) {
        let nxt = -1, cnt = 0;
        for (const d of nb) {
          const j = cur + d;
          if (sk[j] && j !== prev && path.indexOf(j) < 0 && j !== from) { cnt++; nxt = j; }
        }
        if (cnt === 0) return { path, stop: 'end' };
        if (cnt > 1) return { path, stop: 'junction' };
        prev = cur; cur = nxt; path.push(cur);
      }
      return { path, stop: 'len' };
    };

    const done = new Set();
    const ownStamp = new Int32Array(ink.length);
    let stamp = 0;
    const B = o.extendBack, SP = o.extendSpur;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const e = y * S + x;
        if (!sk[e] || deg(e) !== 1) continue;
        let w = walk(-1, e, B);
        let back = w.path[w.path.length - 1];
        let key = e;
        const why = (r) => { if (o.debug) (o.debug.skip = o.debug.skip || []).push([x, y, r]); };
        if (w.stop === 'end' && w.path.length < SP) { why('kúsok'); continue; }          // drobný kúsok
        if (w.stop === 'junction' && w.path.length < SP) {
          // krátka vetva do uzla: buď vidlička na zaoblenom konci čiary (jedna dlhá vetva ďalej),
          // alebo výbežok kostry na rohu (dve dlhé vetvy) — ten sa preskočí
          // Vetvy z uzla sa počítajú na kružnici s polomerom ~SP (zhluky pixelov priamo
          // v uzle by prechod kostrou zmiatli).
          const J = back;
          const ex0 = new Set(w.path.slice(0, -1));
          const [jx, jy] = XY(J);
          const seenB = new Set([J]);
          let front = [J];
          const ring = [];
          for (let g = 0; g < 3 * SP && front.length; g++) {
            const nf = [];
            for (const i of front) for (const d of nb) {
              const j = i + d;
              if (!sk[j] || seenB.has(j) || ex0.has(j)) continue;
              seenB.add(j);
              const [px, py] = XY(j), r = Math.hypot(px - jx, py - jy);
              if (r >= SP && r <= SP + 2) ring.push(j);
              else if (r < SP) nf.push(j);
            }
            front = nf;
          }
          // zhluky na kružnici (8-susednosť) = vetvy
          const ringSet = new Set(ring), clusters = [];
          for (const p of ring) {
            if (!ringSet.has(p)) continue;
            const cl = [p]; ringSet.delete(p);
            for (let k = 0; k < cl.length; k++) for (const d of nb) {
              const j = cl[k] + d;
              if (ringSet.has(j)) { ringSet.delete(j); cl.push(j); }
            }
            clusters.push(cl);
          }
          if (clusters.length !== 1) { why('výbežok ' + clusters.length); continue; }
          key = J;
          back = clusters[0][0];
        }
        if (done.has(key)) continue;
        done.add(key);
        info.ends++;
        // najdlhšie predĺženie, aké tento ťah unesie
        const strokeLen = comp.len[comp.inkId[e]];
        const reach = Math.min(o.extend, o.extendRatio * strokeLen);
        if (reach < 4) { info.short++; continue; }
        if (o.debug) (o.debug.ends = o.debug.ends || []).push([x, y]);

        const [bx, by] = XY(back);
        const kx = key % S, ky = Math.floor(key / S);
        let dx = kx - bx, dy = ky - by;
        const L = Math.hypot(dx, dy);
        if (L < 2) continue;
        dx /= L; dy /= L;
        const ex = x, ey = y;

        // 1) lúč v smere čiary: najprv von zo špičky, potom cez voľné miesto
        let t = 0, outX = -1, outY = -1, hit = null;
        while (t < reach + 40) {
          t += 0.5;
          const px = ex + dx * t, py = ey + dy * t;
          const ix = Math.round(px), iy = Math.round(py);
          if (!inside(ix, iy)) break;
          const isInk = ink[iy * S + ix];
          if (outX < 0) { if (!isInk) { outX = px; outY = py; } continue; }
          if (isInk) { hit = [px, py]; break; }
          if (t - Math.hypot(outX - ex, outY - ey) > reach) break;
        }
        let a = outX >= 0 ? [outX, outY] : [ex, ey];
        let sdx = dx, sdy = dy;

        // 2) bez zásahu: najbližšia cudzia čiara v polkruhu pred koncom (napr. háčik, ktorý
        //    sa stáča od medzery). „Vlastná“ je čiara dosiahnuteľná po čiare do 3·extend px.
        if (!hit) {
          stamp++;
          const G = 3 * o.extend;
          let front = [e]; ownStamp[e] = stamp;
          for (let g = 0; g < G && front.length; g++) {
            const nf = [];
            for (const i of front) {
              const ix = i % S;
              for (const d of nb) {
                const j = i + d;
                if (j < 0 || j >= ink.length || Math.abs((j % S) - ix) > 1) continue;
                if (ink[j] && ownStamp[j] !== stamp) { ownStamp[j] = stamp; nf.push(j); }
              }
            }
            front = nf;
          }
          const R = Math.round(reach), cosLim = Math.cos(100 * Math.PI / 180);
          let best = null, bd = R + 1;
          for (let yy = Math.max(0, ey - R); yy <= Math.min(S - 1, ey + R); yy++) {
            for (let xx = Math.max(0, ex - R); xx <= Math.min(S - 1, ex + R); xx++) {
              const j = yy * S + xx;
              if (!ink[j] || ownStamp[j] === stamp) continue;
              const vx = xx - ex, vy = yy - ey, dist = Math.hypot(vx, vy);
              if (dist >= bd || dist < 1) continue;
              if ((vx * dx + vy * dy) / dist < cosLim) continue;
              bd = dist; best = [xx, yy];
            }
          }
          if (best) {
            hit = best; a = [ex, ey];
            sdx = (best[0] - ex) / bd; sdy = (best[1] - ey) / bd;
          }
        }
        if (o.debug) (o.debug.rays = o.debug.rays || []).push([ex, ey, hit ? hit[0] : ex + dx * t, hit ? hit[1] : ey + dy * t, hit ? 1 : 0]);
        if (!hit) continue;

        // úsečka hrúbky ~3 px od konca po zásah (o kúsok ďalej do čiary)
        const sx = a[0] - sdx * 2, sy = a[1] - sdy * 2, tx = hit[0] + sdx * 2, ty = hit[1] + sdy * 2;
        const len = Math.hypot(tx - sx, ty - sy);
        for (let s = 0; s <= len; s += 0.5) {
          const cx = sx + (tx - sx) * s / len, cy = sy + (ty - sy) * s / len;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const ix = Math.round(cx + ox), iy = Math.round(cy + oy);
            if (inside(ix, iy)) ext[iy * S + ix] = 1;
          }
        }
        segs.push({ a, b: hit, d: [sdx, sdy] });
      }
    }
    return { ext, segs, info };
  }

  // lab: 0 = nikoho (čiara mimo dosahu), -1 = drobná plôška, 1 = pozadie, 2.. = plochy
  function computeLabels(gray, S, o) {
    const N = S * S;
    const ink = new Uint8Array(N);
    for (let i = 0; i < N; i++) ink[i] = gray[i] < o.threshold ? 1 : 0;
    const stack = new Int32Array(N);

    const dil = (m) => { let w = m; for (let k = 0; k < o.gap; k++) w = dilate(w, S, k % 2 === 1); return w; };
    const wall0 = dil(ink);
    let { tmp, comps } = labelFree(wall0, S, stack);
    let repOf = null;                // id → id oblasti, do ktorej sa zlúčila (len pri predĺžení)
    const extInfo = { ends: 0, floating: 0, tried: 0, kept: [], undone: 0 };

    if (o.extend > 0) {
      const { ext, segs, info } = extendEnds(ink, S, o);
      extInfo.ends = info.ends; extInfo.floating = info.short; extInfo.tried = segs.length;
      if (segs.length) {
        const both = new Uint8Array(N);
        for (let i = 0; i < N; i++) both[i] = ink[i] | ext[i];
        const r1 = labelFree(dil(both), S, stack);
        // každá nová oblasť leží celá v jednej pôvodnej; zisti, ktoré pôvodné sa rozdelili
        const parent = new Int32Array(r1.comps.length);
        for (let i = 0; i < N; i++) { const c = r1.tmp[i]; if (c && !parent[c]) parent[c] = tmp[i]; }
        const kids = new Map();
        for (let c = 1; c < r1.comps.length; c++) {
          if (!kids.has(parent[c])) kids.set(parent[c], []);
          kids.get(parent[c]).push(c);
        }
        // rozdelenie platí len vtedy, keď sú obe časti dosť veľké; inak sa časti zlúčia späť
        repOf = new Int32Array(r1.comps.length);
        for (let c = 1; c < r1.comps.length; c++) repOf[c] = c;
        kids.forEach((list) => {
          if (list.length < 2) return;
          list.sort((a, b) => r1.comps[b].area - r1.comps[a].area);
          const big = list[0];
          for (let k = 1; k < list.length; k++) {
            const c = list[k];
            if (r1.comps[c].area < o.minSplit) {
              repOf[c] = big;
              r1.comps[big].area += r1.comps[c].area;
              r1.comps[big].border = r1.comps[big].border || r1.comps[c].border;
              extInfo.undone++;
            }
          }
        });
        tmp = r1.tmp;
        comps = r1.comps;
        for (let i = 0; i < N; i++) if (tmp[i]) tmp[i] = repOf[tmp[i]];
        // ktoré úsečky naozaj oddeľujú dve plochy (na kontrolu a do správy)
        const lookup = (x, y) => {
          const ix = Math.round(x), iy = Math.round(y);
          return (ix >= 0 && iy >= 0 && ix < S && iy < S) ? tmp[iy * S + ix] : 0;
        };
        const off = o.gap + 4;
        for (const s of segs) {
          const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2, nx = -s.d[1], ny = s.d[0];
          const l1 = lookup(mx + nx * off, my + ny * off), l2 = lookup(mx - nx * off, my - ny * off);
          if (l1 && l2 && l1 !== l2) extInfo.kept.push(s);
        }
      }
    }

    const map = new Int32Array(comps.length);
    let next = 2, blocked = 0;
    for (let id = 1; id < comps.length; id++) {
      if (repOf && repOf[id] !== id) continue;   // zlúčené do inej
      const c = comps[id];
      if (c.border) map[id] = BG;
      else if (c.area < o.minRegion) { map[id] = BLOCKED; blocked++; }
      else map[id] = next++;
    }
    const lab = new Int32Array(N);
    for (let i = 0; i < N; i++) if (tmp[i]) lab[i] = map[tmp[i]];

    // rozliatie pod čiaru: viaczdrojové BFS, každý pixel dostane najbližšia plocha
    const dist = new Uint8Array(N);
    const q = stack;   // znovu použijeme pole
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) {
      if (lab[i] < 1) continue;
      const x = i % S;
      if ((x > 0 && lab[i - 1] === 0) || (x < S - 1 && lab[i + 1] === 0) ||
          (i >= S && lab[i - S] === 0) || (i < N - S && lab[i + S] === 0)) q[qt++] = i;
    }
    while (qh < qt) {
      const i = q[qh++];
      const d = dist[i];
      if (d >= o.grow) continue;
      const L = lab[i], x = i % S;
      if (x > 0 && lab[i - 1] === 0) { lab[i - 1] = L; dist[i - 1] = d + 1; q[qt++] = i - 1; }
      if (x < S - 1 && lab[i + 1] === 0) { lab[i + 1] = L; dist[i + 1] = d + 1; q[qt++] = i + 1; }
      if (i >= S && lab[i - S] === 0) { lab[i - S] = L; dist[i - S] = d + 1; q[qt++] = i - S; }
      if (i < N - S && lab[i + S] === 0) { lab[i + S] = L; dist[i + S] = d + 1; q[qt++] = i + S; }
    }

    // štatistiky plôch po rozliatí
    const R = next - 2;
    const st = [];
    for (let r = 0; r < R; r++) st.push({ label: r + 2, area: 0, x0: S, y0: S, x1: -1, y1: -1, sx: 0, sy: 0 });
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const L = lab[y * S + x];
        if (L < 2) continue;
        const s = st[L - 2];
        s.area++; s.sx += x; s.sy += y;
        if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x;
        if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
      }
    }

    // bod na menovku: najhlbšie miesto plochy (ťažisko pri prstenci alebo vlasoch padne mimo).
    // Vzdialenosť k inej ploche/čiare cez dvojprechodovú šachovnicovú transformáciu (3–4).
    const dt = new Uint16Array(N);
    const near = (i, j, w) => (lab[j] === lab[i] ? dt[j] + w : w);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        if (lab[i] < 2) continue;
        let d = 65535;
        if (x > 0) d = Math.min(d, near(i, i - 1, 3)); else d = 3;
        if (y > 0) {
          d = Math.min(d, near(i, i - S, 3));
          d = Math.min(d, x > 0 ? near(i, i - S - 1, 4) : 4, x < S - 1 ? near(i, i - S + 1, 4) : 4);
        } else d = Math.min(d, 3);
        dt[i] = d;
      }
    }
    for (let y = S - 1; y >= 0; y--) {
      for (let x = S - 1; x >= 0; x--) {
        const i = y * S + x;
        if (lab[i] < 2) continue;
        let d = dt[i];
        d = Math.min(d, x < S - 1 ? near(i, i + 1, 3) : 3);
        if (y < S - 1) {
          d = Math.min(d, near(i, i + S, 3));
          d = Math.min(d, x > 0 ? near(i, i + S - 1, 4) : 4, x < S - 1 ? near(i, i + S + 1, 4) : 4);
        } else d = Math.min(d, 3);
        dt[i] = d;
        const s = st[lab[i] - 2];
        if (!(s.depth >= d)) { s.depth = d; s.px = x; s.py = y; }
      }
    }
    return { ink, lab, regions: st, blocked, extInfo };
  }

  // ───────────────────────── obťahovanie ─────────────────────────

  // Hranice masky ako uzavreté slučky. Každá hrana leží medzi vnútorným
  // a vonkajším pixelom; bod slučky je na tejto hrane (pos určí kde).
  function traceMask(inside, x0, y0, x1, y1, pos) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const VW = w + 1, V = VW * (h + 1);
    const out1 = new Int32Array(V).fill(-1), out2 = new Int32Array(V).fill(-1);
    const es = [], ee = [], ex = [], ey = [];   // začiatok, koniec (kľúč vrcholu), bod
    const add = (sx, sy, tx, ty, p) => {
      const e = es.length, k = (sy - y0) * VW + (sx - x0);
      es.push(k); ee.push((ty - y0) * VW + (tx - x0)); ex.push(p[0]); ey.push(p[1]);
      if (out1[k] < 0) out1[k] = e; else out2[k] = e;
    };
    const inn = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && inside(x, y);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        if (!inn(x, y - 1)) add(x, y, x + 1, y, pos(x, y, x, y - 1));
        if (!inn(x + 1, y)) add(x + 1, y, x + 1, y + 1, pos(x, y, x + 1, y));
        if (!inn(x, y + 1)) add(x + 1, y + 1, x, y + 1, pos(x, y, x, y + 1));
        if (!inn(x - 1, y)) add(x, y + 1, x, y, pos(x, y, x - 1, y));
      }
    }
    const E = es.length, used = new Uint8Array(E), loops = [];
    const dir = (e) => {
      const a = es[e], b = ee[e];
      return [(b % VW) - (a % VW), Math.floor(b / VW) - Math.floor(a / VW)];
    };
    for (let s = 0; s < E; s++) {
      if (used[s]) continue;
      const loop = [];
      let cur = s;
      while (cur >= 0 && !used[cur]) {
        used[cur] = 1;
        loop.push([ex[cur], ey[cur]]);
        const v = ee[cur];
        const a = out1[v], b = out2[v];
        const ua = a >= 0 && !used[a], ub = b >= 0 && !used[b];
        if (ua && ub) {
          // sedlo (dva pixely sa dotýkajú rohom): vyber ľavú odbočku
          const d = dir(cur), da = dir(a);
          cur = (d[0] * da[1] - d[1] * da[0]) < 0 ? a : b;
        } else cur = ua ? a : ub ? b : -1;
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }

  function loopArea(p) {
    let a = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
    return Math.abs(a / 2);
  }

  // Douglas–Peucker na uzavretej slučke (bez rekurzie)
  function simplifyLoop(p, eps) {
    const n = p.length;
    if (n < 8) return p;
    // dva najvzdialenejšie body ako kotvy
    let far = 0, best = -1;
    for (let i = 1; i < n; i++) {
      const dx = p[i][0] - p[0][0], dy = p[i][1] - p[0][1], d = dx * dx + dy * dy;
      if (d > best) { best = d; far = i; }
    }
    const keep = new Uint8Array(n);
    keep[0] = keep[far] = 1;
    const stack = [[0, far], [far, n]];
    const e2 = eps * eps;
    while (stack.length) {
      const [a, b] = stack.pop();
      const A = p[a], B = p[b % n];
      const vx = B[0] - A[0], vy = B[1] - A[1], L2 = vx * vx + vy * vy;
      let idx = -1, md = e2;
      for (let i = a + 1; i < b; i++) {
        const P = p[i];
        let d;
        if (L2 === 0) { const dx = P[0] - A[0], dy = P[1] - A[1]; d = dx * dx + dy * dy; }
        else { const c = vx * (P[1] - A[1]) - vy * (P[0] - A[0]); d = c * c / L2; }
        if (d > md) { md = d; idx = i; }
      }
      if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i]);
    return out;
  }

  // jemné vyhladenie schodov (len pre plochy, ktoré nemajú medzitóny)
  function smoothLoop(p) {
    const n = p.length;
    if (n < 5) return p;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      out[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
    return out;
  }

  // číslo s jedným desatinným miestom (0,1 jednotky = 0,2 px rastra), bez nadbytočných znakov
  function fmt(v) {
    let s = (Math.round(v * 10) / 10).toString();
    if (s === '-0') s = '0';
    return s.replace(/^(-?)0\./, '$1.');
  }
  function pair(x, y) {
    const a = fmt(x), b = fmt(y);
    return a + (b[0] === '-' ? '' : ' ') + b;
  }

  // slučka → "M … c … z" (relatívne súradnice); hladké miesta ako krivky, zlomy ostré.
  // eps = tolerancia zjednodušenia v jednotkách výstupu.
  function loopToPath(p, k, cornerDeg, eps) {
    const n = p.length;
    // zaokrúhlime vopred, aby sa relatívne súradnice nesčítavali s chybou
    const R = v => Math.round(v * 10) / 10;
    const P = p.map(q => [R(q[0] * k), R(q[1] * k)]);
    const maxCorner = cornerDeg * Math.PI / 180;
    const tan = new Array(n), sharp = new Uint8Array(n), seg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      seg[i] = Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]);
    }
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const lu = Math.hypot(ux, uy) || 1e-9, lv = Math.hypot(vx, vy) || 1e-9;
      const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
      // Na hladkej krivke zjednodušenej s toleranciou eps je zlom medzi úsekmi
      // dĺžky s približne 8·eps/s. Výrazne väčší zlom je roh (napr. koniec dlhej rovnej hrany).
      const smooth = 8 * eps / Math.max(1e-9, Math.min(lu, lv));
      sharp[i] = (turn > maxCorner || turn > Math.max(25 * Math.PI / 180, 1.8 * smooth)) ? 1 : 0;
      const tx = c[0] - a[0], ty = c[1] - a[1], lt = Math.hypot(tx, ty) || 1e-9;
      tan[i] = [tx / lt, ty / lt];
    }
    // dĺžka ramena: tretina úseku, ale krivka sa od priamky nesmie vydúť o viac ako 2·eps
    const arm = (t, dx, dy, L) => {
      const sin = Math.abs(t[0] * dy - t[1] * dx) / (L || 1e-9);
      return Math.min(L / 3, 2 * eps / Math.max(sin, 1e-6) * 4 / 3);
    };
    let d = 'M' + pair(P[0][0], P[0][1]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, A = P[i], B = P[j];
      const dx = B[0] - A[0], dy = B[1] - A[1], L = seg[i];
      if (sharp[i] && sharp[j]) { d += 'l' + pair(dx, dy); continue; }
      const a1 = sharp[i] ? 0 : arm(tan[i], dx, dy, L);
      const a2 = sharp[j] ? 0 : arm(tan[j], dx, dy, L);
      d += 'c' + pair(tan[i][0] * a1, tan[i][1] * a1) + ' ' + pair(dx - tan[j][0] * a2, dy - tan[j][1] * a2) + ' ' + pair(dx, dy);
    }
    return d + 'z';
  }

  // ───────────────────────── celý krok ─────────────────────────

  async function convert(input, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const t0 = performance.now();
    const { gray, S, box } = await rasterize(input, o);
    const t1 = performance.now();
    const { ink, lab, regions, blocked, extInfo } = computeLabels(gray, S, o);
    const t2 = performance.now();
    const k = VB / S;

    // poradie čítania: po riadkoch (pásy po 64 jednotkách), potom zľava
    regions.forEach(r => { r.cx = r.sx / r.area; r.cy = r.sy / r.area; });
    regions.sort((a, b) => (Math.floor(a.cy * k / 64) - Math.floor(b.cy * k / 64)) || (a.cx - b.cx));

    const mid = (xi, yi, xo, yo) => [(xi + xo + 1) / 2, (yi + yo + 1) / 2];
    const width = String(regions.length).length < 2 ? 2 : String(regions.length).length;
    const parts = [];
    const report = [];
    regions.forEach((r, idx) => {
      const L = r.label;
      const loops = traceMask((x, y) => lab[y * S + x] === L, r.x0, r.y0, r.x1, r.y1, mid)
        .map(l => simplifyLoop(smoothLoop(l), o.simplifyRegion));
      const id = 'r-' + String(idx + 1).padStart(width, '0');
      const d = loops.map(l => loopToPath(l, k, o.corner, o.simplifyRegion * k)).join('');
      parts.push(`<path id="${id}" style="fill:#ff0000" fill-rule="evenodd" d="${d}"/>`);
      report.push({ id, area: Math.round(r.area * k * k),
        bbox: [r.x0 * k, r.y0 * k, (r.x1 + 1) * k, (r.y1 + 1) * k].map(Math.round),
        center: [Math.round(r.cx * k), Math.round(r.cy * k)],
        label: [Math.round((r.px + 0.5) * k), Math.round((r.py + 0.5) * k)],
        radius: Math.round(r.depth / 3 * k) });   // polomer najväčšieho kruhu vo vnútri plochy
    });

    // čiary: bod hranice dopočítaný z medzitónov (subpixelovo)
    const T = o.threshold;
    const iso = (xi, yi, xo, yo) => {
      const gi = gray[yi * S + xi], go = (xo >= 0 && yo >= 0 && xo < S && yo < S) ? gray[yo * S + xo] : 255;
      let t = go > gi ? (T - gi) / (go - gi) : 0.5;
      t = Math.min(0.95, Math.max(0.05, t));
      return [xi + 0.5 + (xo - xi) * t, yi + 0.5 + (yo - yi) * t];
    };
    const inkLoops = traceMask((x, y) => ink[y * S + x] === 1, 0, 0, S - 1, S - 1, iso)
      .filter(l => loopArea(l) >= o.minInk)
      .map(l => simplifyLoop(l, o.simplify));
    const inkD = inkLoops.map(l => loopToPath(l, k, o.corner, o.simplify * k)).join('');
    parts.push(`<path fill="#1a1a1a" fill-rule="evenodd" data-locked="true" d="${inkD}"/>`);
    const t3 = performance.now();

    const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}">\n` + parts.join('\n') + '\n</svg>\n';
    return {
      text,
      box,          // výrez zdroja (v jeho súradniciach), ktorý sa zmapoval na 0 0 1024 1024
      regions: report,
      // úsečky, ktorými predĺženie koncov čiar oddelilo plochy (v jednotkách viewBox)
      extensions: extInfo.kept.map(s => [s.a[0] * k, s.a[1] * k, s.b[0] * k, s.b[1] * k].map(v => Math.round(v * 10) / 10)),
      stats: {
        regions: regions.length,
        blocked,
        ends: extInfo.ends,
        endsShort: extInfo.floating,   // konce príliš krátkych ťahov (nepredlžujú sa)
        extTried: extInfo.tried,
        extKept: extInfo.kept.length,
        extUndone: extInfo.undone,
        inkLoops: inkLoops.length,
        bytes: new Blob([text]).size,
        ms: { raster: Math.round(t1 - t0), plochy: Math.round(t2 - t1), krivky: Math.round(t3 - t2) },
      },
    };
  }

  // Mapa plôch s číslami — podklad na pomenovanie regiónov.
  // Každá plocha má inú svetlú farbu, číslo (= koniec id „r-NN“) stojí v jej najhlbšom mieste.
  // labelFn(r) môže namiesto čísla vrátiť iný text (napr. meno regiónu na kontrolu).
  async function numberedPreview(svgText, regions, size, labelFn) {
    size = size || 1024;
    const color = (i) => `hsl(${(i * 137.508) % 360} 70% 80%)`;
    const byId = new Map(regions.map((r, i) => [r.id, i]));
    const colored = svgText.replace(/<path id="([^"]+)" style="fill:#ff0000"/g,
      (m, id) => `<path id="${id}" style="fill:${color(byId.get(id) || 0)}"`);
    const { img, url } = await loadImage(new Blob([colored], { type: 'image/svg+xml' }));
    const { c, ctx } = newCanvas(size, size);
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);
    const s = size / VB;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    regions.forEach((r) => {
      const t = labelFn ? labelFn(r) : r.id.replace(/^r-0*/, '');
      const p = r.label || r.center;
      const fs = (labelFn ? Math.max(7, Math.min(13, (r.radius || 10) * 0.8)) : Math.max(9, Math.min(26, (r.radius || 10) * 1.2))) * s;
      ctx.font = `bold ${Math.round(fs)}px sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 5); ctx.strokeStyle = '#ffffff';
      ctx.strokeText(t, p[0] * s, p[1] * s);
      ctx.fillStyle = '#b00020';
      ctx.fillText(t, p[0] * s, p[1] * s);
    });
    return c;
  }

  // ───────────────────────── pomenovanie ─────────────────────────

  // slug podľa špecifikácie: malé písmená, bez diakritiky, slová oddelené pomlčkou
  function slugify(name) {
    return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  // Premenuje regióny podľa mapy { "r-01": "auto-kabina", … }.
  // Funguje na medzistupni (id="r-01") aj na výsledku po preprocesore (data-region="r-01").
  // Rovnaké mená dostanú príponu -2, -3…; všetky zásahy vráti v problems.
  function renameRegions(svgText, names) {
    const problems = [];
    const ids = [];
    // aj oblasti odstránené krížikom v svg-lint (data-removed-region), aby po vrátení mali meno
    svgText.replace(/(?:\bid|data-region|data-removed-region)="(r-\d+)"/g, (m, id) => { ids.push(id); return m; });
    const used = new Map();
    const final = {};
    for (const id of ids) {
      if (final[id]) continue;
      const raw = names[id];
      if (raw === undefined || raw === null || raw === '') {
        problems.push({ id, msg: 'bez mena — ostáva ' + id });
        final[id] = id; used.set(id, 1);
        continue;
      }
      let slug = slugify(raw);
      if (slug !== raw) problems.push({ id, msg: `meno „${raw}“ upravené na „${slug}“` });
      if (!SLUG_RE.test(slug)) { problems.push({ id, msg: `neplatné meno „${raw}“ — ostáva ${id}` }); slug = id; }
      if (used.has(slug)) {
        const n = used.get(slug) + 1;
        used.set(slug, n);
        problems.push({ id, msg: `meno „${slug}“ sa opakuje — použité „${slug}-${n}“` });
        slug = slug + '-' + n;
      } else used.set(slug, 1);
      final[id] = slug;
    }
    Object.keys(names).forEach(id => { if (!final[id]) problems.push({ id, msg: 'v obrázku taká plocha nie je' }); });
    const text = svgText.replace(/(\bid|data-region|data-removed-region)="(r-\d+)"/g, (m, attr, id) => `${attr}="${final[id] || id}"`);
    return { text, names: final, problems };
  }

  // Zistí, či SVG už má plochy (data-region alebo červené výplne z Inkscapu).
  function hasRegions(svgText) {
    return /data-region\s*=/.test(svgText) ||
      /fill\s*:\s*(#ff0000|#f00|red)\b/i.test(svgText) ||
      /fill\s*=\s*"(#ff0000|#f00|red)"/i.test(svgText);
  }

  window.LineartRegions = { convert, numberedPreview, renameRegions, slugify, hasRegions, DEFAULTS };
})();
