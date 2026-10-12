// validators.js — pravidlá validácie SVG omaľovánok
// Pomenovania regiónov sa NEKONTROLUJÚ (podľa zadania)

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Pomocné: zistí, či je element "len obrys" (stroke, žiadny zmysluplný fill)
  function isStrokeOnly(el) {
    const fill = el.getAttribute('fill');
    const stroke = el.getAttribute('stroke');
    const hasStroke = stroke && stroke !== 'none';
    const noFill = fill === 'none' || (fill === null && !el.hasAttribute('data-region'));
    return hasStroke && noFill;
  }

  // Vráti krátky úryvok kódu reprezentujúci element (otvárací tag bez detí)
  function snippetOf(el) {
    if (!el || !el.tagName) return '';
    const attrs = [];
    for (const a of el.attributes) {
      let v = a.value;
      if (v.length > 60) v = v.slice(0, 57) + '…';
      attrs.push(`${a.name}="${v}"`);
    }
    return `<${el.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  }

  // ---- jednotlivé pravidlá ----
  // Každé pravidlo vracia pole "issues" alebo [].
  // issue: { ruleId, severity, title, detail, element?, elements?, snippet?, fixable, fixId?, hint? }

  function rule_parse(doc) {
    const pe = doc.querySelector('parsererror');
    if (pe) {
      return [{
        ruleId: 'parse',
        severity: 'error',
        title: 'SVG sa nedá rozparsovať',
        detail: 'Súbor obsahuje neplatné XML. Skontrolujte v editore.',
        snippet: pe.textContent.split('\n').slice(0, 3).join(' ').slice(0, 200),
        fixable: false,
      }];
    }
    return [];
  }

  function rule_root(svg) {
    const issues = [];
    if (svg.nodeName.toLowerCase() !== 'svg') {
      issues.push({
        ruleId: 'root.notSvg',
        severity: 'error',
        title: 'Koreňový element nie je <svg>',
        detail: 'Súbor musí začínať <svg> elementom.',
        fixable: false,
      });
    }
    return issues;
  }

  function rule_viewBox(svg) {
    const issues = [];
    const vb = svg.getAttribute('viewBox');
    if (!vb) {
      issues.push({
        ruleId: 'viewBox.missing',
        severity: 'error',
        title: 'Chýba atribút viewBox',
        detail: 'Root <svg> musí mať viewBox="0 0 1024 1024".',
        element: svg,
        snippet: snippetOf(svg),
        fixable: true,
        fixId: 'addViewBox',
        hint: 'Auto-fix doplní viewBox="0 0 1024 1024".',
      });
      return issues;
    }
    const parts = vb.trim().split(/[\s,]+/).map(parseFloat);
    if (parts.length !== 4 || parts.some(isNaN)) {
      issues.push({
        ruleId: 'viewBox.invalid',
        severity: 'error',
        title: `Neplatný viewBox: "${vb}"`,
        detail: 'Očakávaný formát: "0 0 1024 1024" (min-x min-y width height).',
        element: svg,
        snippet: `viewBox="${vb}"`,
        fixable: false,
      });
      return issues;
    }
    const [x, y, w, h] = parts;
    if (Math.abs(w - h) > 0.5) {
      issues.push({
        ruleId: 'viewBox.notSquare',
        severity: 'error',
        title: `viewBox nie je štvorcový (${w}×${h})`,
        detail: 'Pomer strán musí byť 1:1.',
        element: svg,
        snippet: `viewBox="${vb}"`,
        fixable: false,
      });
    } else if (w !== 1024 || h !== 1024 || x !== 0 || y !== 0) {
      issues.push({
        ruleId: 'viewBox.notStandard',
        severity: 'warning',
        title: `viewBox je "${vb}" namiesto "0 0 1024 1024"`,
        detail: 'Špecifikácia odporúča presne 1024×1024.',
        element: svg,
        snippet: `viewBox="${vb}"`,
        fixable: true,
        fixId: 'normalizeViewBox',
        hint: 'Auto-fix prepíše viewBox na "0 0 1024 1024" (geometria sa neprepočítava).',
      });
    }
    return issues;
  }

  function rule_widthHeight(svg) {
    const issues = [];
    const w = svg.getAttribute('width');
    const h = svg.getAttribute('height');
    if (w || h) {
      issues.push({
        ruleId: 'root.widthHeight',
        severity: 'warning',
        title: 'Root <svg> má width/height',
        detail: 'Šírku a výšku má riadiť CSS aplikácie. Odstráňte atribúty width a height z root <svg>.',
        element: svg,
        snippet: `width="${w || ''}" height="${h || ''}"`,
        fixable: true,
        fixId: 'removeRootDims',
      });
    }
    return issues;
  }

  function rule_forbiddenElements(doc) {
    const issues = [];
    const forbidden = [
      { tag: 'linearGradient', label: '<linearGradient>' },
      { tag: 'radialGradient', label: '<radialGradient>' },
      { tag: 'filter',         label: '<filter>' },
      { tag: 'pattern',        label: '<pattern>' },
      { tag: 'mask',           label: '<mask>' },
      { tag: 'style',          label: '<style>' },
    ];
    for (const { tag, label } of forbidden) {
      const els = doc.getElementsByTagName(tag);
      for (const el of Array.from(els)) {
        const sev = (tag === 'style') ? 'error' : 'error';
        const fixId = (tag === 'style') ? 'removeStyleBlocks'
                    : (tag === 'pattern' ? 'stripDefsElement'
                    : 'stripDefsElement');
        issues.push({
          ruleId: `forbidden.${tag}`,
          severity: sev,
          title: `Zakázaný element ${label}`,
          detail: tag === 'style'
            ? 'Štýly v SVG sa nemajú používať. Vyfarbenie riadi Vue aplikácia.'
            : `Element ${label} produkuje vizuálny efekt, ktorý sa v omaľovánke nepoužije.`,
          element: el,
          snippet: snippetOf(el),
          fixable: true,
          fixId,
        });
      }
    }
    return issues;
  }

  function rule_metadataElements(doc) {
    const issues = [];
    for (const tag of ['title', 'desc', 'metadata']) {
      for (const el of Array.from(doc.getElementsByTagName(tag))) {
        issues.push({
          ruleId: `meta.${tag}`,
          severity: 'info',
          title: `Metadáta: <${tag}>`,
          detail: `Element <${tag}> možno bez následkov odstrániť.`,
          element: el,
          snippet: snippetOf(el) + (el.textContent ? `${el.textContent.slice(0, 40)}` : ''),
          fixable: true,
          fixId: 'removeMetadata',
        });
      }
    }
    return issues;
  }

  function rule_inlineStyle(doc) {
    const issues = [];
    const all = doc.getElementsByTagName('*');
    for (const el of Array.from(all)) {
      if (!el.hasAttribute('style')) continue;
      const styleVal = (el.getAttribute('style') || '').trim();
      // Ignoruj prázdny style alebo style obsahujúci IBA pointer-events
      // (to je runtime atribút aplikácie, nie chyba v zdrojovom SVG)
      const declarations = styleVal.split(';').map(s => s.trim()).filter(Boolean);
      const onlyPointerEvents = declarations.length > 0 &&
        declarations.every(d => /^pointer-events\s*:/i.test(d));
      if (declarations.length === 0 || onlyPointerEvents) continue;
      const MOVABLE = /^(fill|fill-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-dasharray|stroke-dashoffset|clip-rule|vector-effect)$/i;
      const lost = declarations.map(d => d.split(':')[0].trim()).filter(p => !MOVABLE.test(p) && !/^pointer-events$/i.test(p));
      issues.push({
        ruleId: 'attr.style',
        severity: 'error',
        title: `Inline style na <${el.tagName.toLowerCase()}>`,
        detail: 'Inline style="..." nie je povolený. Auto-fix presunie fill/stroke vlastnosti do prezentačných atribútov' + (el.hasAttribute('data-region') ? ' (región dostane fill="#ffffff").' : '.'),
        hint: lost.length ? `Tieto vlastnosti sa nedajú presunúť a auto-fix ich zahodí: ${lost.join(', ')}` : undefined,
        element: el,
        snippet: `style="${styleVal.slice(0, 60)}"`,
        fixable: true,
        fixId: 'stripInlineStyle',
      });
    }
    return issues;
  }

  function rule_classAttr(doc) {
    const issues = [];
    for (const el of Array.from(doc.getElementsByTagName('*'))) {
      if (el.hasAttribute('class')) {
        issues.push({
          ruleId: 'attr.class',
          severity: 'warning',
          title: `Atribút class na <${el.tagName.toLowerCase()}>`,
          detail: 'CSS triedy (napr. cls-1 z Canvy) v SVG nepatria.',
          element: el,
          snippet: `class="${el.getAttribute('class')}"`,
          fixable: true,
          fixId: 'stripClassAttr',
        });
      }
    }
    return issues;
  }

  function rule_transformOnGroup(doc, svg) {
    const issues = [];
    const targets = [svg, ...Array.from(doc.getElementsByTagName('g'))];
    for (const el of targets) {
      if (el.hasAttribute('transform')) {
        issues.push({
          ruleId: 'attr.transformGroup',
          severity: 'warning',
          title: `Transform na <${el.tagName.toLowerCase()}>`,
          detail: 'Transformácie na skupinách komplikujú spracovanie. Aplikujte ich priamo na cesty.',
          element: el,
          snippet: `transform="${el.getAttribute('transform').slice(0, 60)}"`,
          fixable: true,
          fixId: 'stripGroupTransform',
          hint: 'Auto-fix iba odstráni atribút (geometria sa neprepočíta).',
        });
      }
    }
    return issues;
  }

  // Vyfarbiteľné oblasti = elementy s data-region
  const REGION_TAGS = new Set(['path', 'circle', 'ellipse', 'polygon', 'rect', 'polyline']);

  function rule_regionsExist(doc) {
    const issues = [];
    const regions = doc.querySelectorAll('[data-region]');
    if (regions.length === 0) {
      issues.push({
        ruleId: 'region.none',
        severity: 'error',
        title: 'V SVG nie sú žiadne vyfarbiteľné oblasti',
        detail: 'Ani jeden element nemá atribút data-region="...". Bez toho sa nedá nič vyfarbiť.',
        fixable: false,
      });
    }
    return issues;
  }

  function rule_regionTag(doc) {
    const issues = [];
    for (const el of doc.querySelectorAll('[data-region]')) {
      if (!REGION_TAGS.has(el.tagName.toLowerCase())) {
        issues.push({
          ruleId: 'region.badTag',
          severity: 'warning',
          title: `data-region na <${el.tagName.toLowerCase()}>`,
          detail: 'data-region by mal byť na <path>, <circle>, <ellipse>, <polygon> alebo <rect>.',
          element: el,
          snippet: snippetOf(el),
          fixable: false,
        });
      }
    }
    return issues;
  }

  function rule_regionFill(doc) {
    const issues = [];
    for (const el of doc.querySelectorAll('[data-region]')) {
      const fill = (el.getAttribute('fill') || '').trim().toLowerCase();
      if (!fill) {
        issues.push({
          ruleId: 'region.noFill',
          severity: 'error',
          title: `Oblasť bez explicitného fill`,
          detail: 'Vyfarbiteľná oblasť musí mať fill="#ffffff". Bez výplne prehliadač nemusí registrovať kliknutia.',
          element: el,
          snippet: snippetOf(el),
          fixable: true,
          fixId: 'setRegionFillWhite',
        });
      } else if (fill === 'none' || fill === 'transparent') {
        issues.push({
          ruleId: 'region.fillNone',
          severity: 'error',
          title: `Oblasť má fill="${fill}"`,
          detail: 'Vyfarbiteľná oblasť nesmie mať fill="none" — kliknutie cez ňu prepadne.',
          element: el,
          snippet: snippetOf(el),
          fixable: true,
          fixId: 'setRegionFillWhite',
        });
      }
    }
    return issues;
  }

  function rule_regionOpacity(doc) {
    const issues = [];
    for (const el of doc.querySelectorAll('[data-region]')) {
      const op = parseFloat(el.getAttribute('opacity') || el.getAttribute('fill-opacity') || '1');
      if (!isNaN(op) && op < 1) {
        issues.push({
          ruleId: 'region.opacity',
          severity: 'warning',
          title: `Oblasť má opacity ${op}`,
          detail: 'Vyfarbiteľné oblasti musia byť plne nepriehľadné.',
          element: el,
          snippet: snippetOf(el),
          fixable: true,
          fixId: 'removeRegionOpacity',
        });
      }
      const style = el.getAttribute('style') || '';
      if (/filter\s*:/i.test(style)) {
        issues.push({
          ruleId: 'region.filter',
          severity: 'error',
          title: 'Oblasť má CSS filter',
          detail: 'filter: ... nie je povolený na vyfarbiteľných oblastiach.',
          element: el,
          snippet: `style="${style.slice(0, 60)}"`,
          fixable: true,
          fixId: 'stripInlineStyle',
        });
      }
    }
    return issues;
  }

  function rule_regionPathClosed(doc) {
    const issues = [];
    for (const el of doc.querySelectorAll('path[data-region]')) {
      const d = (el.getAttribute('d') || '').trim();
      if (!d) continue;
      const last = d[d.length - 1];
      if (last !== 'Z' && last !== 'z') {
        issues.push({
          ruleId: 'region.notClosed',
          severity: 'warning',
          title: 'Path oblasti nie je uzavretý',
          detail: 'Path musí končiť na Z alebo z, inak farba pretečie do susednej oblasti.',
          element: el,
          snippet: `d="…${d.slice(-30)}"`,
          fixable: true,
          fixId: 'closePathZ',
          hint: 'Auto-fix doplní "Z" na koniec atribútu d.',
        });
      }
    }
    return issues;
  }

  function rule_regionSize(doc) {
    // bbox kontrola — funguje len ak je SVG mounted v DOM
    const issues = [];
    for (const el of doc.querySelectorAll('[data-region]')) {
      if (typeof el.getBBox !== 'function') continue;
      let bb;
      try { bb = el.getBBox(); } catch (e) { continue; }
      if (bb.width < 60 || bb.height < 60) {
        issues.push({
          ruleId: 'region.tooSmall',
          severity: 'info',
          title: `Malá oblasť (${Math.round(bb.width)}×${Math.round(bb.height)})`,
          detail: 'Pod 60×60 v jednotkách viewBoxu — dieťa to ťažko trafí prstom. Zvážte data-locked="true".',
          element: el,
          snippet: snippetOf(el),
          fixable: false,
        });
      }
    }
    return issues;
  }

  function rule_fileSize(text) {
    const issues = [];
    const bytes = new Blob([text]).size;
    const kb = bytes / 1024;
    if (kb > 100) {
      issues.push({
        ruleId: 'file.size',
        severity: 'info',
        title: `Súbor je veľký: ${kb.toFixed(1)} KB`,
        detail: 'Odporúčaná hranica je ~100 KB. Spustite SVGO na optimalizáciu.',
        fixable: false,
      });
    }
    return issues;
  }

  function rule_dataLockedNoRegion(doc) {
    // info: ak má element aj data-region aj data-locked, je to konflikt
    const issues = [];
    for (const el of doc.querySelectorAll('[data-region][data-locked]')) {
      issues.push({
        ruleId: 'region.lockedConflict',
        severity: 'warning',
        title: 'Element má súčasne data-region aj data-locked',
        detail: 'Tieto atribúty sú navzájom výlučné. Vyberte si jeden.',
        element: el,
        snippet: snippetOf(el),
        fixable: false,
      });
    }
    return issues;
  }

  // ---- hlavná validačná funkcia ----
  // Spúšťa sa proti DOM elementu mountedSvg (real <svg> v stránke, nie iba parsed)
  // tak, aby bolo dostupné getBBox(). Validuje aj text súboru pre file-size.
  function validateSvg(mountedSvg, sourceText) {
    const issues = [];

    // Najprv reparse pre detekciu parsererror — DOMParser vie hlásiť chyby
    const parser = new DOMParser();
    const reparsed = parser.parseFromString(sourceText, 'image/svg+xml');
    issues.push(...rule_parse(reparsed));
    if (issues.some(i => i.ruleId === 'parse')) return issues;

    if (!mountedSvg || mountedSvg.tagName.toLowerCase() !== 'svg') {
      issues.push({
        ruleId: 'root.notSvg',
        severity: 'error',
        title: 'Koreňový element nie je <svg>',
        detail: 'Súbor musí začínať <svg> elementom.',
        fixable: false,
      });
      return issues;
    }

    const doc = mountedSvg.ownerDocument;
    // všetky rules bežia priamo nad live <svg> v DOM — getBBox funguje
    issues.push(...rule_root(mountedSvg));
    issues.push(...rule_viewBox(mountedSvg));
    issues.push(...rule_widthHeight(mountedSvg));
    issues.push(...rule_forbiddenElements(mountedSvg));
    issues.push(...rule_metadataElements(mountedSvg));
    issues.push(...rule_inlineStyle(mountedSvg));
    issues.push(...rule_classAttr(mountedSvg));
    issues.push(...rule_transformOnGroup(mountedSvg, mountedSvg));
    issues.push(...rule_regionsExist(mountedSvg));
    issues.push(...rule_regionTag(mountedSvg));
    issues.push(...rule_regionFill(mountedSvg));
    issues.push(...rule_regionOpacity(mountedSvg));
    issues.push(...rule_regionPathClosed(mountedSvg));
    issues.push(...rule_dataLockedNoRegion(mountedSvg));
    issues.push(...rule_regionSize(mountedSvg));
    issues.push(...rule_fileSize(sourceText));
    if (window.SvgRegionOverlap) {
      try { issues.push(...window.SvgRegionOverlap.check(mountedSvg)); }
      catch (e) { console.warn('Kontrola duplicitných regiónov zlyhala:', e); }
    }

    return issues;
  }

  window.SvgValidator = { validateSvg };
})();
