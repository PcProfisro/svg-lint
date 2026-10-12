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
        const f = (attrUp(el, 'fill', svg) || '').toLowerCase();
        if (f && f !== 'none' && f !== 'transparent') ctx.fill(p, rule);
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

    const owner = new Int32Array(W * H).fill(-1);
    const masks = regions.map((el, i) => {
      const m = rasterize(el, 'fill');
      if (m) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.data[y * m.w + x]) owner[(y + m.y) * W + x + m.x] = i;
      return m;
    });
    const lockedShapes = new Set();
    svg.querySelectorAll('[data-locked="true"]').forEach(l => {
      if (l.matches(SHAPES)) lockedShapes.add(l);
      l.querySelectorAll(SHAPES).forEach(c => lockedShapes.add(c));
    });
    lockedShapes.forEach(l => {
      if (l.hasAttribute('data-region')) return;
      const m = rasterize(l, 'locked');
      if (m) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.data[y * m.w + x]) owner[(y + m.y) * W + x + m.x] = -1;
    });

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
      if (isWhite(fillOf(el))) {
        if (!core && ratio < CFG.maxVisibleRatio) issues.push({
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
    return issues;
  }

  window.SvgRegionOverlap = { check, CFG };
})();
