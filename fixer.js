// fixer.js — automatické opravy SVG na základe issues z validators.js
// Pracuje s klonom SVG DOM, vracia opravený text aj počet vykonaných opráv.

(function () {
  'use strict';

  const MOVABLE_PROPS = new Set([
    'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'clip-rule', 'vector-effect',
  ]);

  // Každý fix dostane (svgRoot, issueElement, issue) a vykoná mutáciu.
  const FIXES = {
    addViewBox(svg) {
      svg.setAttribute('viewBox', '0 0 1024 1024');
    },
    normalizeViewBox(svg) {
      svg.setAttribute('viewBox', '0 0 1024 1024');
    },
    removeRootDims(svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
    },
    stripDefsElement(svg, el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    },
    removeStyleBlocks(svg, el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    },
    removeMetadata(svg, el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    },
    // Presunie bezpečné vlastnosti zo style do prezentačných atribútov, potom style odstráni.
    // Regióny dostanú vždy fill="#ffffff". Nepresunuteľné vlastnosti zahodí (validátor ich hlási).
    stripInlineStyle(svg, el) {
      if (!el) return;
      const style = el.getAttribute('style') || '';
      const isRegion = el.hasAttribute('data-region');
      for (const decl of style.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const val = decl.slice(i + 1).replace(/!important/i, '').trim();
        if (!val || !MOVABLE_PROPS.has(prop)) continue;
        if (isRegion && prop === 'fill') continue;
        el.setAttribute(prop, val); // style mal prednosť pred atribútom → prepíš
      }
      el.removeAttribute('style');
      if (isRegion) el.setAttribute('fill', '#ffffff');
    },
    stripClassAttr(svg, el) {
      if (el) el.removeAttribute('class');
    },
    stripGroupTransform(svg, el) {
      if (el) el.removeAttribute('transform');
    },
    setRegionFillWhite(svg, el) {
      if (el) el.setAttribute('fill', '#ffffff');
    },
    removeRegionOpacity(svg, el) {
      if (el) {
        el.removeAttribute('opacity');
        el.removeAttribute('fill-opacity');
      }
    },
    removeHiddenRegion(svg, el) {
      if (!el || !el.parentNode) return;
      let parent = el.parentNode;
      parent.removeChild(el);
      // odstráň prázdne obaly <g>
      while (parent && parent !== svg && parent.tagName && parent.tagName.toLowerCase() === 'g' && !parent.hasAttribute('data-locked') && !Array.from(parent.childNodes).some(n => n.nodeType === 1)) {
        const up = parent.parentNode;
        up.removeChild(parent);
        parent = up;
      }
    },
    closePathZ(svg, el) {
      if (el) {
        const d = (el.getAttribute('d') || '').trim();
        if (d && d[d.length - 1] !== 'Z' && d[d.length - 1] !== 'z') {
          el.setAttribute('d', d + ' Z');
        }
      }
    },
  };

  // Aplikuje opravy. issues musí byť pole vrátené z validateSvg na MOUNTED svg.
  // Vytvorí klon parametra `mountedSvg`, prejde issues a vykoná každý fix v poradí.
  // Mapuje elementy z mounted DOM na klon pomocou indexu (rovnaká štruktúra).
  function applyFixes(mountedSvg, issues) {
    // Sklonuj
    const clone = mountedSvg.cloneNode(true);

    // Vytvorenie mapy: každému elementu v mounted dáme dočasné id, klonuj má rovnaké
    // pozície -> môžeme prejsť pomocou cesty (rodičovských indexov).
    function pathOf(target, root) {
      const path = [];
      let cur = target;
      while (cur && cur !== root) {
        const parent = cur.parentNode;
        if (!parent) return null;
        const idx = Array.prototype.indexOf.call(parent.childNodes, cur);
        path.push(idx);
        cur = parent;
      }
      if (cur !== root) return null;
      return path.reverse();
    }
    function resolveInClone(path) {
      let cur = clone;
      for (const idx of path) {
        if (!cur || !cur.childNodes[idx]) return null;
        cur = cur.childNodes[idx];
      }
      return cur;
    }

    // najprv nájdi všetky ciele v klone (odstraňovanie by inak posunulo indexy)
    const jobs = [];
    for (const issue of issues) {
      if (!issue.fixable || !issue.fixId) continue;
      const fix = FIXES[issue.fixId];
      if (!fix) continue;
      let target = null;
      if (issue.element) {
        const path = pathOf(issue.element, mountedSvg);
        if (path) target = resolveInClone(path);
      } else {
        target = clone;
      }
      jobs.push({ issue, fix, target });
    }
    let applied = 0;
    for (const { issue, fix, target } of jobs) {
      try {
        fix(clone, target, issue);
        applied++;
      } catch (e) {
        console.warn('Fix zlyhal:', issue.fixId, e);
      }
    }

    // Serializácia
    const serializer = new XMLSerializer();
    let out = serializer.serializeToString(clone);
    // pretty-print: pridaj newliny medzi top-level elementy
    out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;

    return { text: out, applied };
  }

  window.SvgFixer = { applyFixes };
})();
