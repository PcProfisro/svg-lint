// region-overlap.js — rastrová detekcia skrytých bielych kópií regiónov
// (podľa uploads/Oprava-duplicitnych-regionov.md). Beží nad mounted <svg>.
(function () {
  'use strict';

  const CFG = { radius: 3, maxVisibleRatio: 0.10, scaleTarget: 1024 };
  const SHAPES = 'path,circle,ellipse,polygon,polyline,rect,line';

  function isWhite(f) {
    const v = (f || '').trim().toLowerCase();
    return v === '#ffffff' || v === '#fff' || v === 'white';
  }
  function fillOf(el) {
    let f = el.getAttribute('fill');
    if (!f) { const m = /fill\s*:\s*([^;]+)/i.exec(el.getAttribute('style') || ''); if (m) f = m[1]; }
    return (f || '').trim().toLowerCase();
  }
  function num(el, a) { return parseFloat(el.getAttribute(a)) || 0; }
  function pointsPath(pts, close) {
    const n = (pts || '').trim().split(/[\s,]+/).map(Number);
    let d = '';
    for (let i = 0; i + 1 < n.length; i += 2) d += (i ? 'L' : 'M') + n[i] + ' ' + n[i + 1];
    return d + (close ? 'Z' : '');
  }
  function toPath2D(el) {
    const t = el.tagName.toLowerCase();
    if (t === 'path') return new Path2D(el.getAttribute('d') || '');
    const p = new Path2D();
    if (t === 'circle') { p.arc(num(el, 'cx'), num(el, 'cy'), num(el, 'r'), 0, Math.PI * 2); return p; }
    if (t === 'ellipse') { p.ellipse(num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry'), 0, 0, Math.PI * 2); return p; }
    if (t === 'rect') { p.rect(num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height')); return p; }
    if (t === 'polygon') return new Path2D(pointsPath(el.getAttribute('points'), true));
    if (t === 'polyline') return new Path2D(pointsPath(el.getAttribute('points'), false));
    if (t === 'line') { p.moveTo(num(el, 'x1'), num(el, 'y1')); p.lineTo(num(el, 'x2'), num(el, 'y2')); return p; }
    return null;
  }
  function attrUp(el, name, root) {
    for (let c = el; c && c !== root.parentNode; c = c.parentNode) {
      if (c.getAttribute && c.getAttribute(name)) return c.getAttribute(name);
      if (c.getAttribute) { const m = new RegExp(name + '\\s*:\\s*([^;]+)', 'i').exec(c.getAttribute('style') || ''); if (m) return m[1].trim(); }
    }
    return null;
  }

  function check(svg) {
    const issues = [];
    const regions = Array.from(svg.querySelectorAll('[data-region]'));
    if (!regions.length) return issues;

    // duplicitné hodnoty data-region
    const seen = new Map();
    regions.forEach(r => { const k = r.getAttribute('data-region'); seen.set(k, (seen.get(k) || 0) + 1); });
    for (const [k, n] of seen) if (n > 1) issues.push({
      ruleId: 'region.duplicateId', severity: 'warning',
      title: `Duplicitná hodnota data-region="${k}" (${n}×)`,
      detail: 'Hodnoty data-region musia byť v súbore unikátne.', fixable: false,
    });

    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : { x: 0, y: 0, width: 1024, height: 1024 };
    const s = CFG.scaleTarget / Math.max(vb.width, vb.height);
    const W = Math.ceil(vb.width * s), H = Math.ceil(vb.height * s);
    const R = Math.max(1, Math.round(CFG.radius * s));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rootCTM = svg.getScreenCTM();
    const rootInv = rootCTM ? rootCTM.inverse() : null;

    function setMatrix(el) {
      let m = null;
      const sc = el.getScreenCTM && el.getScreenCTM();
      if (rootInv && sc) m = rootInv.multiply(sc);
      ctx.setTransform(s, 0, 0, s, -vb.x * s, -vb.y * s);
      if (m) ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    }
    // nakreslí element, vráti masku v rámci bounding boxu
    function rasterize(el, mode) {
      const p = toPath2D(el);
      if (!p) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      setMatrix(el);
      ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
      const rule = (attrUp(el, 'fill-rule', svg) || 'nonzero') === 'evenodd' ? 'evenodd' : 'nonzero';
      if (mode === 'fill') ctx.fill(p, rule);
      else {
        // 'locked' = výplň aj ťah; 'stroke' = len ťah
        const f = (attrUp(el, 'fill', svg) || '').toLowerCase();
        if (mode !== 'stroke' && f && f !== 'none' && f !== 'transparent') ctx.fill(p, rule);
        const st = (attrUp(el, 'stroke', svg) || '').toLowerCase();
        if (st && st !== 'none') {
          ctx.lineWidth = parseFloat(attrUp(el, 'stroke-width', svg) || '1') || 1;
          ctx.lineJoin = attrUp(el, 'stroke-linejoin', svg) || 'miter';
          ctx.lineCap = attrUp(el, 'stroke-linecap', svg) || 'butt';
          ctx.stroke(p);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const img = ctx.getImageData(0, 0, W, H).data;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (img[(y * W + x) * 4 + 3] >= 128) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) return { x: 0, y: 0, w: 0, h: 0, data: new Uint8Array(0), sum: 0 };
      const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8Array(w * h);
      let sum = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (img[((y + y0) * W + x + x0) * 4 + 3] >= 128) { data[y * w + x] = 1; sum++; }
      return { x: x0, y: y0, w, h, data, sum };
    }

    // Mapa vlastníctva pixelov v skutočnom poradí vykresľovania (poradie dokumentu):
    // neskorší element prepíše skorší. Obrysy pred regiónmi sú teda pod nimi.
    // Región s vlastným obrysom (stroke) si ním zakrýva okraj vlastnej výplne:
    // tie pixely dostanú hodnotu -(i + 2) („ťah regiónu i“).
    // layers = výplne a ťahy všetkých prvkov v poradí vykresľovania, každá so svojou
    // „farbou“ (vyfarbiteľný región má vlastnú) — z nich sa skladá výrez obrázka
    // s prvkom a bez neho, aby sa dalo overiť, že jeho odstránenie nič nezmení.
    const owner = new Int32Array(W * H).fill(-1);
    const layers = [];
    const colorIds = new Map();
    // null = nekreslí sa; 0 = biela, to isté ako prázdne pozadie (obrázok je na bielej);
    // 1 = všetky veľmi tmavé odtiene (#000, #1a1a1a… sú na obrázku rovnaké)
    const luma = (v) => {
      if (v === 'black') return 0;
      let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
      let r, g, b;
      if (m) {
        let h = m[1];
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
      } else if ((m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v))) {
        [r, g, b] = [+m[1], +m[2], +m[3]];
      } else return null;
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    const colorCls = (v) => {
      v = (v || '').trim().toLowerCase();
      if (v === 'none' || v === 'transparent') return null;
      if (isWhite(v)) return 0;
      const l = luma(v);
      if (l !== null && l < 64) return 1;
      if (!colorIds.has(v)) colorIds.set(v, 2 + colorIds.size);
      return colorIds.get(v);
    };
    const regionIndex = new Map(regions.map((el, i) => [el, i]));
    const lockedShapes = new Set();
    svg.querySelectorAll('[data-locked="true"]').forEach(l => {
      if (l.matches(SHAPES)) lockedShapes.add(l);
      l.querySelectorAll(SHAPES).forEach(c => lockedShapes.add(c));
    });
    const masks = new Array(regions.length).fill(null);
    const strokeMasks = new Array(regions.length).fill(null);
    // bitmapu ani text táto kontrola nevykresľuje — pri nich sa o prvku s data-region
    // aj data-locked nedá povedať, že je zakrytý (pod ním môže byť kresba z bitmapy)
    const unknownContent = Array.from(svg.querySelectorAll('image, text, foreignObject, use'))
      .some(el => !el.closest('defs, clipPath, mask, pattern, symbol'));
    const paint = (m, v) => {
      if (m) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.data[y * m.w + x]) owner[(y + m.y) * W + x + m.x] = v;
    };
    const hasStroke = (el) => {
      const st = (attrUp(el, 'stroke', svg) || '').toLowerCase();
      const sw = parseFloat(attrUp(el, 'stroke-width', svg) || '1');
      return st && st !== 'none' && st !== 'transparent' && sw > 0;
    };
    const isLockedToo = (el) => el.getAttribute('data-locked') === 'true' || !!el.closest('[data-locked="true"]');
    svg.querySelectorAll(SHAPES + ',[data-region]').forEach(el => {
      const ri = regionIndex.has(el) ? regionIndex.get(el) : -1;
      if (ri >= 0 && masks[ri]) return;
      const layer = { el, fill: null, fillCls: 0, stroke: null, strokeCls: 0 };
      if (ri < 0 && !lockedShapes.has(el)) {
        // iný tvar (nie región, nie zamknutý) — do mapy vlastníctva nepatrí, ale je vidieť,
        // takže sa ráta pri skladaní výrezu (napr. čierne polygóny pod čiarami)
        if (el.closest('defs, clipPath, mask, pattern, symbol, marker')) return;
        const fc = colorCls(attrUp(el, 'fill', svg) || '#000');
        if (fc !== null) { layer.fill = rasterize(el, 'fill'); layer.fillCls = fc; }
        if (hasStroke(el)) { layer.stroke = rasterize(el, 'stroke'); layer.strokeCls = colorCls(attrUp(el, 'stroke', svg)); }
        layers.push(layer);
        return;
      }
      if (ri >= 0) {
        const m = rasterize(el, 'fill');
        masks[ri] = m;
        paint(m, ri);
        layer.fill = m;
        layer.fillCls = isLockedToo(el) ? colorCls(fillOf(el) || '#000') : 1000 + ri;
        if (hasStroke(el)) {
          const sm = rasterize(el, 'stroke');
          strokeMasks[ri] = sm;
          paint(sm, -(ri + 2));
          layer.stroke = sm;
          layer.strokeCls = colorCls(attrUp(el, 'stroke', svg));
        }
      } else {
        const fc = colorCls(attrUp(el, 'fill', svg) || '#000');   // bez fill kreslí SVG čiernou
        if (fc !== null) { layer.fill = rasterize(el, 'fill'); layer.fillCls = fc; paint(layer.fill, -1); }
        if (hasStroke(el)) { layer.stroke = rasterize(el, 'stroke'); layer.strokeCls = colorCls(attrUp(el, 'stroke', svg)); paint(layer.stroke, -1); }
      }
      layers.push(layer);
    });

    // výrez obrázka (obdĺžnik bb) zložený z vrstiev okrem tých v `bez`
    const compose = (bb, bez) => {
      const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, out = new Int32Array(w * h);
      for (const L of layers) {
        if (bez.has(L.el)) continue;
        for (const [m, c] of [[L.fill, L.fillCls], [L.stroke, L.strokeCls]]) {
          if (!m || c === null || !m.sum) continue;
          const ax = Math.max(m.x, bb.x0), bx = Math.min(m.x + m.w, bb.x1);
          const ay = Math.max(m.y, bb.y0), by = Math.min(m.y + m.h, bb.y1);
          for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++)
            if (m.data[(y - m.y) * m.w + x - m.x]) out[(y - bb.y0) * w + x - bb.x0] = c;
        }
      }
      return out;
    };
    const layerOf = new Map(layers.map(L => [L.el, L]));
    // koľko pixelov sa zmení, keď sa prvok odstráni (okrem pixelov, kde je vidieť
    // jeho vlastnú výplň, ak ignoreOwnFill — tie má odstránenie kópie práve zmeniť)
    const removalDiff = (el, removed, ignoreOwnFill) => {
      const L = layerOf.get(el);
      if (!L) return 0;
      let bb = null;
      for (const m of [L.fill, L.stroke]) {
        if (!m || !m.sum) continue;
        bb = bb ? { x0: Math.min(bb.x0, m.x), y0: Math.min(bb.y0, m.y), x1: Math.max(bb.x1, m.x + m.w), y1: Math.max(bb.y1, m.y + m.h) }
                : { x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h };
      }
      if (!bb) return 0;
      bb = { x0: Math.max(0, bb.x0 - 2), y0: Math.max(0, bb.y0 - 2), x1: Math.min(W, bb.x1 + 2), y1: Math.min(H, bb.y1 + 2) };
      const a = compose(bb, removed);
      const without = new Set(removed); without.add(el);
      const b = compose(bb, without);
      let n = 0;
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k] && !(ignoreOwnFill && a[k] === L.fillCls)) n++;
      return n;
    };
    const removedSoFar = new Set();

    // disk offsets pre eróziu
    const disk = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) disk.push([dx, dy]);

    regions.forEach((el, i) => {
      const m = masks[i];
      if (!m) return;
      const id = el.getAttribute('data-region') || el.id || `#${i}`;
      const snippet = el.outerHTML.length > 160 ? el.outerHTML.slice(0, 160) + '…' : el.outerHTML;
      if (m.sum === 0) {
        issues.push({ ruleId: 'region.empty', severity: 'error', title: `Región „${id}" má nulovú plochu`,
          detail: 'Región sa nevykreslí, ale počíta sa do dokončenia obrázka.', element: el, snippet, fixable: true, fixId: 'removeHiddenRegion' });
        return;
      }
      let visible = 0, core = false;
      for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) {
        if (owner[y * W + x] !== i) continue;
        visible++;
        if (core) continue;
        let ok = true;
        for (const [dx, dy] of disk) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || owner[yy * W + xx] !== i) { ok = false; break; }
        }
        if (ok) core = true;
      }
      const ratio = visible / m.sum;
      // Kópia musí ležať pod iným (neskorším) regiónom — biely región zakrytý len čiarami
      // nie je kópia.
      let underRegion = false;
      for (let y = m.y; y < m.y + m.h && !underRegion; y++) for (let x = m.x; x < m.x + m.w; x++) {
        if (!m.data[(y - m.y) * m.w + x - m.x]) continue;
        const o = owner[y * W + x];
        if (o >= 0 && o !== i) { underRegion = true; break; }
      }
      // Odstránenie nesmie zmeniť obrázok viac ako o pár pixelov (zaokrúhlenie okrajov):
      // - prvok s data-region aj data-locked (pôvodný tvar kresby pod výplňou z Inkscapu)
      //   nesmie zmeniť nič — rovnako ako krok 3 v oprav_svg.py;
      // - obyčajná kópia smie zmeniť len pixely, kde vykúka jej výplň (tú bielu čiaru
      //   má oprava odstrániť), nie čiary — napr. ak tvorí kus obrysu jej vlastný stroke.
      const lockedToo = isLockedToo(el);
      const LIM = 3 * s * s;
      let hidden = false;
      if (isWhite(fillOf(el)) && underRegion && !(lockedToo && unknownContent)
          && (lockedToo || (!core && ratio < CFG.maxVisibleRatio))) {
        hidden = removalDiff(el, removedSoFar, !lockedToo) <= LIM;
      }
      if (hidden) removedSoFar.add(el);
      if (isWhite(fillOf(el))) {
        if (hidden) issues.push({
          ruleId: 'region.hiddenCopy', severity: 'error',
          title: `Skrytá kópia regiónu „${id}"`,
          detail: `Biely región je prekrytý neskoršími regiónmi, viditeľných je len ${(ratio * 100).toFixed(1)} % (tenký okraj). Po vyfarbení zostane biela čiara a obrázok sa nedá dokončiť.`,
          hint: 'Auto-fix element odstráni; ostatné regióny ostanú nezmenené.',
          element: el, snippet, fixable: true, fixId: 'removeHiddenRegion',
        });
      } else if (visible === 0) {
        issues.push({ ruleId: 'region.coveredNonWhite', severity: 'warning', title: `Nebiely región „${id}" je úplne zakrytý`,
          detail: 'Región nie je vidieť — skontrolujte ručne.', element: el, snippet, fixable: false });
      }
    });
    // Poistka: oprava nesmie odstrániť všetky regióny (alebo väčšinu) — to je takmer
    // isto chybná detekcia; ponecháme len hlásenie na ručnú kontrolu.
    const removable = issues.filter(i => i.fixId === 'removeHiddenRegion');
    if (removable.length && removable.length >= Math.max(1, Math.ceil(regions.length / 2))) {
      removable.forEach(i => {
        i.fixable = false;
        i.severity = 'warning';
        i.hint = `Auto-fix vypnutý: odstránil by ${removable.length} z ${regions.length} regiónov — pravdepodobne chybná detekcia, skontrolujte ručne.`;
      });
    }
    return issues;
  }

  window.SvgRegionOverlap = { check, CFG };
})();
