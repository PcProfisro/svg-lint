// preprocessor.js — transformácie aplikované na SVG text PRED validáciou.
//
// 1) Každý <path> so style="..." obsahujúcim fill:#ff0000:
//    - id="X" sa odstráni
//    - pôvodný style sa odstráni
//    - doplní sa data-region="X" (hodnota z id) a fill="#ffffff"
//
// 2) Každý <path> so style="..." BEZ fill:#ff0000:
//    - id, style sa odstránia
//    - doplnia sa obrysové atribúty (fill #1a1a1a, stroke #1a1a1a, width 4, round caps/joins)
//    - doplní sa data-locked="true"
//
// 3) Cesty BEZ style atribútu sa nemodifikujú (pozadie, hotové obrysy).
//
// 4) <g transform="translate(tx, ty)"> — translate sa "zapečie" do súradníc
//    všetkých potomkov (path d, rect x/y, circle/ellipse cx/cy, polygon/polyline
//    points). Pre nepodporované transformy (scale, rotate, matrix) sa atribút iba
//    odstráni s varovaním.
//
// 5) Atribút clip-path="url(#…)" sa odstráni zo všetkých elementov; nepoužité
//    <clipPath> definície v <defs> sa vyčistia.

(function () {
  'use strict';

  const RED_RE = /fill\s*:\s*(#ff0000|#f00|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)|red)\b/i;

  // ── Helper: pekné formátovanie čísla (max 4 desatinné, bez zbytočných núl)
  function fmt(n) {
    if (!isFinite(n)) return '0';
    const r = Math.round(n * 10000) / 10000;
    return r.toString();
  }

  // ── Helper: aplikuj translate(tx, ty) na atribút d cesty
  function bakePathTranslate(d, tx, ty) {
    const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
    if (!tokens) return d;
    const NUM_ARGS = { M:2, L:2, H:1, V:1, C:6, S:4, Q:4, T:2, A:7, Z:0 };

    let out = [];
    let cmd = null;
    let firstArgsAfterCmd = true;
    let consumedAnyPair = false;
    let i = 0;
    let safety = tokens.length * 2;

    while (i < tokens.length && safety-- > 0) {
      const t = tokens[i];
      if (/[a-zA-Z]/.test(t)) {
        cmd = t;
        out.push(cmd);
        firstArgsAfterCmd = true;
        i++;
        if (cmd.toUpperCase() === 'Z') {
          cmd = null;
        }
        continue;
      }
      if (!cmd) { i++; continue; }

      // implicit repeat: po prvej dávke argumentov M/m je ďalšia dávka L/l
      let effCmd = cmd;
      if (!firstArgsAfterCmd && (cmd === 'M' || cmd === 'm')) {
        effCmd = cmd === 'M' ? 'L' : 'l';
      }
      const upper = effCmd.toUpperCase();
      const isAbs = effCmd === upper;
      const n = NUM_ARGS[upper];
      if (!n) { i++; continue; }
      if (i + n > tokens.length) break;

      const args = tokens.slice(i, i + n).map(parseFloat);
      const treatAsAbs = isAbs || !consumedAnyPair; // úplne prvý ťah je absolútny

      if (upper === 'M' || upper === 'L' || upper === 'T') {
        if (treatAsAbs) { args[0] += tx; args[1] += ty; }
      } else if (upper === 'H') {
        if (isAbs) args[0] += tx;
      } else if (upper === 'V') {
        if (isAbs) args[0] += ty;
      } else if (upper === 'C') {
        if (isAbs) {
          args[0]+=tx; args[2]+=tx; args[4]+=tx;
          args[1]+=ty; args[3]+=ty; args[5]+=ty;
        }
      } else if (upper === 'S' || upper === 'Q') {
        if (isAbs) {
          args[0]+=tx; args[2]+=tx;
          args[1]+=ty; args[3]+=ty;
        }
      } else if (upper === 'A') {
        if (isAbs) { args[5]+=tx; args[6]+=ty; }
      }

      out.push(...args.map(fmt));
      i += n;
      firstArgsAfterCmd = false;
      consumedAnyPair = true;
    }
    return out.join(' ');
  }

  // ── Helper: parse "translate(x[, y])"; vráti {tx, ty} alebo null
  function parseTranslate(str) {
    if (!str) return null;
    const m = String(str).trim().match(
      /^translate\s*\(\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(?:[,\s]\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?))?\s*\)$/
    );
    if (!m) return null;
    return { tx: parseFloat(m[1]), ty: m[2] !== undefined ? parseFloat(m[2]) : 0 };
  }

  // ── Aplikuj translate na všetkých priamych potomkov skupiny
  function applyTranslateToChildren(g, tx, ty) {
    for (const child of Array.from(g.children)) {
      const tag = child.tagName.toLowerCase().replace(/^.*:/, '');
      if (tag === 'path') {
        const d = child.getAttribute('d');
        if (d) child.setAttribute('d', bakePathTranslate(d, tx, ty));
      } else if (tag === 'rect') {
        const x = parseFloat(child.getAttribute('x') || '0');
        const y = parseFloat(child.getAttribute('y') || '0');
        child.setAttribute('x', fmt(x + tx));
        child.setAttribute('y', fmt(y + ty));
      } else if (tag === 'circle' || tag === 'ellipse') {
        const cx = parseFloat(child.getAttribute('cx') || '0');
        const cy = parseFloat(child.getAttribute('cy') || '0');
        child.setAttribute('cx', fmt(cx + tx));
        child.setAttribute('cy', fmt(cy + ty));
      } else if (tag === 'line') {
        const x1 = parseFloat(child.getAttribute('x1') || '0');
        const y1 = parseFloat(child.getAttribute('y1') || '0');
        const x2 = parseFloat(child.getAttribute('x2') || '0');
        const y2 = parseFloat(child.getAttribute('y2') || '0');
        child.setAttribute('x1', fmt(x1 + tx));
        child.setAttribute('y1', fmt(y1 + ty));
        child.setAttribute('x2', fmt(x2 + tx));
        child.setAttribute('y2', fmt(y2 + ty));
      } else if (tag === 'polygon' || tag === 'polyline') {
        const pts = (child.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat);
        for (let i = 0; i + 1 < pts.length; i += 2) {
          pts[i] += tx;
          pts[i + 1] += ty;
        }
        child.setAttribute('points', pts.map(fmt).join(' '));
      } else if (tag === 'g') {
        // skupinu obohatíme o translate (jej vlastný transform sa zachová pred ňou)
        const existing = child.getAttribute('transform');
        const prefix = `translate(${fmt(tx)}, ${fmt(ty)})`;
        child.setAttribute('transform', existing ? `${prefix} ${existing}` : prefix);
      }
      // ostatné (text, use, image…) — necháme tak, ich shift sa nerieši
    }
  }

  // ── Spracuj všetky <g transform="..."> v dokumente
  function processGroupTransforms(svgRoot) {
    let baked = 0;       // translate(x,y) → zapečené
    let stripped = 0;    // iné transformy → iba zmazané
    let safety = 100;
    let changed = true;
    while (changed && safety-- > 0) {
      changed = false;
      const groups = Array.from(svgRoot.querySelectorAll('g[transform]'));
      for (const g of groups) {
        const tr = g.getAttribute('transform') || '';
        const trans = parseTranslate(tr);
        if (trans && trans.tx === 0 && trans.ty === 0) {
          g.removeAttribute('transform');
          changed = true;
          continue;
        }
        if (trans) {
          applyTranslateToChildren(g, trans.tx, trans.ty);
          g.removeAttribute('transform');
          baked++;
          changed = true;
        } else {
          // zložitejší transform — strip
          g.removeAttribute('transform');
          stripped++;
          changed = true;
        }
      }
    }
    // root <svg> má tiež transform v ojedinelých prípadoch — strip
    if (svgRoot.hasAttribute('transform')) {
      svgRoot.removeAttribute('transform');
      stripped++;
    }
    return { baked, stripped };
  }

  // ── Spracuj clip-path atribúty a nepoužité <clipPath> v <defs>
  function processClipPaths(svgRoot) {
    let removedAttrs = 0;
    let removedDefs = 0;
    // 1. odstráň clip-path atribúty zo všetkých elementov
    const refs = Array.from(svgRoot.querySelectorAll('[clip-path]'));
    for (const el of refs) {
      el.removeAttribute('clip-path');
      removedAttrs++;
    }
    // 2. odstráň všetky <clipPath> (po kroku 1 sú nepoužité)
    const cps = Array.from(svgRoot.getElementsByTagName('clipPath'));
    for (const cp of cps) {
      cp.parentNode && cp.parentNode.removeChild(cp);
      removedDefs++;
    }
    // 3. ak ostalo prázdne <defs>, zmaž
    const defsList = Array.from(svgRoot.getElementsByTagName('defs'));
    for (const defs of defsList) {
      if (!defs.children || defs.children.length === 0) {
        defs.parentNode && defs.parentNode.removeChild(defs);
      }
    }
    return { removedAttrs, removedDefs };
  }

  // ── Hlavná transformácia path-ov (regióny vs. obrysy)
  function processPaths(svgRoot) {
    const paths = svgRoot.getElementsByTagName('path');
    let regions = 0;
    let locked = 0;
    let fallbackCounter = 1;
    const log = [];

    for (const p of Array.from(paths)) {
      const style = p.getAttribute('style');
      if (!style) continue;
      const isRed = RED_RE.test(style);

      if (isRed) {
        const originalId = p.getAttribute('id');
        const regionName = originalId && originalId.trim()
          ? originalId.trim()
          : `region-${fallbackCounter++}`;
        if (originalId) p.removeAttribute('id');
        p.removeAttribute('style');
        if (!p.hasAttribute('data-region')) p.setAttribute('data-region', regionName);
        p.setAttribute('fill', '#ffffff');
        regions++;
        log.push({ id: originalId, region: regionName });
      } else {
        p.removeAttribute('id');
        p.removeAttribute('style');
        p.setAttribute('fill', '#1a1a1a');
        p.setAttribute('stroke', '#1a1a1a');
        p.setAttribute('stroke-width', '4');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        if (!p.hasAttribute('data-locked')) p.setAttribute('data-locked', 'true');
        locked++;
      }
    }
    return { regions, locked, log };
  }

  function preprocess(sourceText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sourceText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) {
      return { text: sourceText, changes: 0, locked: 0, log: [] };
    }
    const svgRoot = doc.documentElement;

    // dôležité poradie: najprv clip-path (čisté), nakoniec path-y.
    // POZN: transform spracovanie je v tejto verzii VYNECHANÉ (experiment).
    const tr = { baked: 0, stripped: 0 };
    const cp = processClipPaths(svgRoot);
    const pp = processPaths(svgRoot);

    const anyChange = pp.regions || pp.locked || tr.baked || tr.stripped || cp.removedAttrs || cp.removedDefs;
    if (!anyChange) {
      return { text: sourceText, changes: 0, locked: 0, log: [] };
    }

    const serialized = new XMLSerializer().serializeToString(doc);
    return {
      text: serialized,
      changes: pp.regions,
      locked: pp.locked,
      transformsBaked: tr.baked,
      transformsStripped: tr.stripped,
      clipAttrsRemoved: cp.removedAttrs,
      clipDefsRemoved: cp.removedDefs,
      log: pp.log,
    };
  }

  window.SvgPreprocessor = { preprocess };
})();
