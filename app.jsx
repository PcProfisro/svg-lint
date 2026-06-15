// app.jsx — SVG validátor pre omaľovánky (linter UI)
const { useState, useRef, useEffect, useCallback, useMemo } = React;

// ---- detská paleta (12 farieb) ----
const PALETTE = [
  '#ef4444', // červená
  '#f97316', // oranžová
  '#facc15', // žltá
  '#84cc16', // limetka
  '#22c55e', // zelená
  '#14b8a6', // tyrkysová
  '#3b82f6', // modrá
  '#6366f1', // indigo
  '#a855f7', // fialová
  '#ec4899', // ružová
  '#92400e', // hnedá
  '#1a1a1a', // čierna
];

// ---- severity meta ----
const SEV = {
  error:   { label: 'CHYBA',     icon: '✗', cls: 'sev-error',   order: 0 },
  warning: { label: 'VAROVANIE', icon: '⚠', cls: 'sev-warning', order: 1 },
  info:    { label: 'INFO',      icon: 'ℹ', cls: 'sev-info',    order: 2 },
};

// ---- helpers ----
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function makePointerEventsNone(svg) {
  // Použijeme data-atribút (nie inline style!), aby validátor nehlásil
  // false-positive "inline style". CSS pravidlo v index.html sa o pointer-events postará.
  svg.querySelectorAll('[data-locked]').forEach(el => {
    el.setAttribute('data-pe', 'none');
  });
  // Stroke-only elementy bez data-region/data-locked = obrysové vrstvy
  svg.querySelectorAll('*').forEach(el => {
    if (el === svg) return;
    if (el.hasAttribute('data-region')) return;
    if (el.hasAttribute('data-locked')) return;
    const fill = el.getAttribute('fill');
    const stroke = el.getAttribute('stroke');
    const hasStroke = stroke && stroke !== 'none';
    const noFill = (fill === 'none' || fill === 'transparent');
    if (hasStroke && noFill) {
      el.setAttribute('data-pe', 'none');
    }
  });
}

function clearHighlights(svg) {
  if (!svg) return;
  svg.querySelectorAll('.__highlight-rect').forEach(el => el.remove());
}

function highlightElement(svg, target) {
  clearHighlights(svg);
  if (!svg || !target || typeof target.getBBox !== 'function') return false;
  let bb;
  try { bb = target.getBBox(); } catch (e) { return false; }
  if (!bb || (bb.width === 0 && bb.height === 0)) return false;
  const NS = 'http://www.w3.org/2000/svg';
  const pad = 8;
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', bb.x - pad);
  rect.setAttribute('y', bb.y - pad);
  rect.setAttribute('width', Math.max(bb.width + pad * 2, 12));
  rect.setAttribute('height', Math.max(bb.height + pad * 2, 12));
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#f85149');
  rect.setAttribute('stroke-width', '6');
  rect.setAttribute('stroke-dasharray', '14 10');
  rect.setAttribute('vector-effect', 'non-scaling-stroke');
  rect.setAttribute('class', '__highlight-rect');
  rect.style.pointerEvents = 'none';
  const anim = document.createElementNS(NS, 'animate');
  anim.setAttribute('attributeName', 'stroke-dashoffset');
  anim.setAttribute('from', '0');
  anim.setAttribute('to', '-48');
  anim.setAttribute('dur', '0.9s');
  anim.setAttribute('repeatCount', 'indefinite');
  rect.appendChild(anim);
  // Tlmené pozadie naokolo, aby kontrastovalo
  const halo = document.createElementNS(NS, 'rect');
  halo.setAttribute('x', bb.x - pad);
  halo.setAttribute('y', bb.y - pad);
  halo.setAttribute('width', Math.max(bb.width + pad * 2, 12));
  halo.setAttribute('height', Math.max(bb.height + pad * 2, 12));
  halo.setAttribute('fill', 'rgba(248,81,73,0.08)');
  halo.setAttribute('class', '__highlight-rect');
  halo.style.pointerEvents = 'none';
  svg.appendChild(halo);
  svg.appendChild(rect);
  return true;
}

// ============================================================
// EmptyState — drag & drop / file picker / sample loader
// ============================================================
function EmptyState({ onLoadText, onLoadSample }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef();

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  };
  const onPick = (e) => {
    const f = e.target.files[0];
    if (f) readFile(f);
  };
  function readFile(f) {
    if (!/\.svg$/i.test(f.name) && f.type !== 'image/svg+xml') {
      alert('Vyber prosím .svg súbor.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onLoadText(reader.result, f.name, f.size);
    reader.readAsText(f);
  }

  return (
    <div
      className={`dropzone ${drag ? 'drag' : ''}`}
      onDragEnter={() => setDrag(true)}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        style={{ display: 'none' }}
        onChange={onPick}
      />
      <div className="dropzone-inner">
        <div className="dropzone-icon">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="8" y="12" width="48" height="40" rx="4" stroke="#7d8590" strokeWidth="2" strokeDasharray="4 4"/>
            <path d="M22 36 L32 26 L42 36" stroke="#58a6ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M32 26 L32 44" stroke="#58a6ff" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="dropzone-title">Pretiahni sem .svg súbor</div>
        <div className="dropzone-sub">alebo klikni a vyber zo zariadenia</div>
        <button
          className="btn-secondary"
          onClick={(e) => { e.stopPropagation(); onLoadSample(); }}
          style={{ marginTop: 24 }}
        >
          Načítať ukážkový (chybný) SVG
        </button>
      </div>
    </div>
  );
}

// ============================================================
// IssueRow — jeden riadok v zozname problémov
// ============================================================
function IssueRow({ issue, active, expanded, onClick }) {
  const meta = SEV[issue.severity];
  return (
    <div
      className={`issue ${meta.cls} ${active ? 'active' : ''} ${expanded ? 'expanded' : ''}`}
      onClick={onClick}
    >
      <div className="issue-line">
        <span className={`sev-pill ${meta.cls}`}>
          <span className="sev-icon">{meta.icon}</span>
          {meta.label}
        </span>
        <span className="issue-title">{issue.title}</span>
        <span className="issue-rule">{issue.ruleId}</span>
      </div>
      {expanded && (
        <div className="issue-detail">
          <p>{issue.detail}</p>
          {issue.snippet && (
            <pre className="snippet"><code>{issue.snippet}</code></pre>
          )}
          {issue.hint && <div className="hint">→ {issue.hint}</div>}
          {issue.fixable && <div className="fix-badge">auto-fix dostupný</div>}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Palette — výber farby
// ============================================================
function Palette({ active, onPick }) {
  return (
    <div className="palette">
      {PALETTE.map(c => (
        <button
          key={c}
          className={`swatch ${active === c ? 'on' : ''}`}
          style={{ background: c }}
          onClick={() => onPick(c)}
          aria-label={c}
        />
      ))}
      <button
        className={`swatch swatch-white ${active === '#ffffff' ? 'on' : ''}`}
        style={{ background: '#ffffff' }}
        onClick={() => onPick('#ffffff')}
        aria-label="biela (reset)"
        title="Biela — vymazať farbu"
      />
    </div>
  );
}

// ============================================================
// SvgPreview — vykreslí SVG a zachytáva kliky na data-region
// ============================================================
// ---- spočítaj vyfarbené / všetky uzavreté oblasti ----
function isWhiteFill(f) {
  const v = (f || '').trim().toLowerCase();
  return v === '' || v === '#ffffff' || v === '#fff' || v === 'white' || v === 'none';
}
function countRegions(svg) {
  if (!svg) return { total: 0, colored: 0 };
  const regions = svg.querySelectorAll('[data-region]');
  let colored = 0;
  regions.forEach(r => { if (!isWhiteFill(r.getAttribute('fill'))) colored++; });
  return { total: regions.length, colored };
}

function SvgPreview({ svgText, activeColor, onSvgReady, highlightTarget, onPaint }) {
  const containerRef = useRef();
  const colorRef = useRef(activeColor);
  const paintRef = useRef(onPaint);
  useEffect(() => { colorRef.current = activeColor; }, [activeColor]);
  useEffect(() => { paintRef.current = onPaint; }, [onPaint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    if (!svgText) return;

    // Vlož pomocou DOMParser, presypme len <svg> element
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== 'svg') {
      container.textContent = '⚠ Súbor nie je platné SVG.';
      onSvgReady(null);
      return;
    }
    // klon do nášho dokumentu
    const imported = document.importNode(svg, true);
    container.appendChild(imported);

    // šírka 100%
    imported.removeAttribute('width');
    imported.removeAttribute('height');
    imported.style.width = '100%';
    imported.style.height = '100%';
    imported.style.maxWidth = '100%';
    imported.style.maxHeight = '100%';

    // pointer-events
    makePointerEventsNone(imported);

    // klik handler — vyfarbi data-region
    const handler = (e) => {
      let t = e.target;
      while (t && t !== imported) {
        if (t.hasAttribute && t.hasAttribute('data-region')) {
          t.setAttribute('fill', colorRef.current);
          if (paintRef.current) paintRef.current(imported);
          return;
        }
        t = t.parentNode;
      }
    };
    imported.addEventListener('click', handler);

    onSvgReady(imported);

    return () => {
      imported.removeEventListener('click', handler);
    };
  }, [svgText]);

  // highlight
  useEffect(() => {
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) return;
    if (highlightTarget) {
      highlightElement(svg, highlightTarget);
    } else {
      clearHighlights(svg);
    }
  }, [highlightTarget]);

  return <div ref={containerRef} className="svg-preview-canvas" />;
}

// ============================================================
// App
// ============================================================
function App() {
  const variant = document.getElementById('root')?.dataset.variant || '';
  const isExperiment = variant === 'no-transform';
  const [svgText, setSvgText] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [fileSize, setFileSize] = useState(0);
  const [issues, setIssues] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [activeColor, setActiveColor] = useState(PALETTE[0]);
  const [mountedSvg, setMountedSvg] = useState(null);
  const [hideInfo, setHideInfo] = useState(false);
  const [preprocessInfo, setPreprocessInfo] = useState(null);
  const [regionStats, setRegionStats] = useState({ total: 0, colored: 0 });

  const recountRegions = useCallback((svg) => {
    setRegionStats(countRegions(svg));
  }, []);

  const loadText = async (text, name, size) => {
    // 1) preprocessing — fill:#ff0000 → data-region, atď.
    let processedText = text;
    let info = null;
    try {
      const result = window.SvgPreprocessor.preprocess(text);
      processedText = result.text;
      if (result.changes > 0 || result.locked > 0 || result.transformsBaked > 0 || result.transformsStripped > 0 || result.clipAttrsRemoved > 0 || result.clipDefsRemoved > 0) {
        info = result;
      }
    } catch (e) {
      console.warn('Preprocessor zlyhal:', e);
    }

    // Nastavíme stav medzitým, aby používateľ niečo videl
    setFileName(name);
    setSvgText(processedText);
    setFileSize(new Blob([processedText]).size);
    setSelectedIdx(null);
    setIssues([]);
    setPreprocessInfo(info);

    // 2) SVGO optimalizácia (async — modul sa stiahne pri prvom behu)
    if (window.SvgoRunner) {
      setSvgoRunning(true);
      try {
        const before = new Blob([processedText]).size;
        const svgoResult = await window.SvgoRunner.run(processedText);
        if (svgoResult.ok) {
          setSvgText(svgoResult.text);
          setFileSize(svgoResult.bytesAfter);
          setPreprocessInfo({
            ...(info || { changes: 0, locked: 0 }),
            svgo: {
              before,
              after: svgoResult.bytesAfter,
              delta: before - svgoResult.bytesAfter,
            },
          });
        } else {
          console.warn('SVGO auto-step zlyhal:', svgoResult.error);
        }
      } finally {
        setSvgoRunning(false);
      }
    }
  };

  const loadSample = async () => {
    try {
      const res = await fetch('sample-broken.svg');
      const text = await res.text();
      loadText(text, 'sample-broken.svg', new Blob([text]).size);
    } catch (e) {
      alert('Ukážku sa nepodarilo načítať.');
    }
  };

  const handleSvgReady = useCallback((svg) => {
    setMountedSvg(svg);
    if (svg && svgText) {
      // počkaj na commit DOM (setTimeout funguje aj v skrytých taboch, rAF býva throttlovaný)
      setTimeout(() => {
        const found = window.SvgValidator.validateSvg(svg, svgText);
        // zoradenie: error → warning → info, v rámci stability zachované
        found.sort((a, b) => SEV[a.severity].order - SEV[b.severity].order);
        setIssues(found);
        recountRegions(svg);
      });
    } else {
      setIssues([]);
    }
  }, [svgText]);

  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const i of issues) c[i.severity]++;
    return c;
  }, [issues]);

  const filteredIssues = useMemo(
    () => hideInfo ? issues.filter(i => i.severity !== 'info') : issues,
    [issues, hideInfo]
  );

  const highlightTarget = selectedIdx !== null ? filteredIssues[selectedIdx]?.element : null;

  const applyFix = () => {
    if (!mountedSvg) return;
    const fixable = issues.filter(i => i.fixable);
    if (fixable.length === 0) {
      alert('Nie sú žiadne automaticky opraviteľné problémy.');
      return;
    }
    const { text, applied } = window.SvgFixer.applyFixes(mountedSvg, issues);
    setSvgText(text);
    setSelectedIdx(null);
    // mini-feedback
    setTimeout(() => alert(`Aplikovaných opráv: ${applied}\nSVG bol prevalidovaný.`), 50);
  };

  const serializeSvg = (resetRegions) => {
    if (!mountedSvg) return null;
    const clone = mountedSvg.cloneNode(true);
    clone.querySelectorAll('.__highlight-rect').forEach(el => el.remove());
    // Odstráň interné runtime atribúty
    clone.querySelectorAll('[data-pe]').forEach(el => el.removeAttribute('data-pe'));
    clone.removeAttribute('style');
    if (resetRegions) {
      clone.querySelectorAll('[data-region]').forEach(el => {
        el.setAttribute('fill', '#ffffff');
      });
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  };

  const downloadBlob = (text, suffix) => {
    const blob = new Blob([text], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fileName || 'svg').replace(/\.svg$/i, '') + suffix;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadFixed = () => {
    const text = serializeSvg(false);
    if (!text) return;
    // SVG → PNG cez canvas
    const RENDER_SIZE = 2048; // ostrejší výstup (2× viewBox)
    const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = RENDER_SIZE;
      canvas.height = RENDER_SIZE;
      const ctx = canvas.getContext('2d');
      // biele pozadie (PNG nemá natívne biele plátno ako SVG s viewBox)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);
      ctx.drawImage(img, 0, 0, RENDER_SIZE, RENDER_SIZE);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          alert('Vytvorenie PNG zlyhalo.');
          return;
        }
        const pngUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = (fileName || 'svg').replace(/\.svg$/i, '') + '.png';
        a.click();
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('SVG sa nepodarilo načítať ako obrázok.');
    };
    img.src = url;
  };

  const downloadClean = () => {
    const text = serializeSvg(true);
    if (text) downloadBlob(text, '.clean.svg');
  };

  const reset = () => {
    setSvgText(null);
    setFileName(null);
    setFileSize(0);
    setIssues([]);
    setSelectedIdx(null);
    setMountedSvg(null);
  };

  const [svgoRunning, setSvgoRunning] = useState(false);

  const runSvgo = async () => {
    if (!svgText || svgoRunning) return;
    if (!window.SvgoRunner) {
      alert('SVGO sa nenačítal.');
      return;
    }
    setSvgoRunning(true);
    try {
      const result = await window.SvgoRunner.run(svgText);
      if (!result.ok) {
        alert(`SVGO zlyhal: ${result.error}`);
        return;
      }
      setSvgText(result.text);
      setFileSize(result.bytesAfter);
      setSelectedIdx(null);
      setPreprocessInfo({
        changes: 0,
        locked: 0,
        svgo: {
          before: result.bytesBefore,
          after: result.bytesAfter,
          delta: result.bytesBefore - result.bytesAfter,
        },
      });
    } finally {
      setSvgoRunning(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">●</span>
          <span className="brand-name">svg-lint</span>
          {isExperiment ? (
            <span className="brand-sub" style={{ color: '#f5a623' }}>⚗ experiment: BEZ transform spracovania</span>
          ) : (
            <span className="brand-sub">validátor omaľovánkových SVG</span>
          )}
        </div>
        <div className="topbar-right">
          {fileName && (
            <>
              <span className="file-pill">
                <span className="file-icon">▸</span>
                {fileName}
                <span className="file-meta">{fmtBytes(fileSize)}</span>
              </span>
              <button className="btn-ghost" onClick={reset}>
                Nový súbor
              </button>
            </>
          )}
        </div>
      </header>

      {!svgText ? (
        <main className="empty-main">
          <EmptyState onLoadText={loadText} onLoadSample={loadSample} />
          <div className="empty-help">
            <div className="empty-help-title">Čo aplikácia robí</div>
            <ul>
              <li>Skontroluje SVG podľa špecifikácie pre omaľovánku (viewBox, vyfarbiteľné oblasti, zakázané elementy…)</li>
              <li>Označí každý problém ako <span className="sev-pill sev-error inline"><span className="sev-icon">✗</span>CHYBA</span> / <span className="sev-pill sev-warning inline"><span className="sev-icon">⚠</span>VAROVANIE</span> / <span className="sev-pill sev-info inline"><span className="sev-icon">ℹ</span>INFO</span></li>
              <li>Klikom na chybu zvýrazní problémový element priamo v náhľade</li>
              <li>Umožní otestovať vyfarbenie kliknutím (vedierko)</li>
              <li>Pokúsi sa o automatickú opravu a ponúkne stiahnutie čistého SVG</li>
            </ul>
          </div>
        </main>
      ) : (
        <main className="work">
          {/* ĽAVÝ STĹPEC — linter panel */}
          <section className="lint-pane">
            <div className="lint-header">
              <div className="lint-summary">
                <span className={`count ${counts.error ? 'on' : ''}`}>
                  <span className="sev-icon sev-error">✗</span> {counts.error} chýb
                </span>
                <span className={`count ${counts.warning ? 'on' : ''}`}>
                  <span className="sev-icon sev-warning">⚠</span> {counts.warning} varovaní
                </span>
                <span className={`count ${counts.info ? 'on' : ''}`}>
                  <span className="sev-icon sev-info">ℹ</span> {counts.info} info
                </span>
              </div>
              <div className="lint-controls">
                <label className="toggle">
                  <input type="checkbox" checked={hideInfo} onChange={e => setHideInfo(e.target.checked)} />
                  <span>Skryť info</span>
                </label>
              </div>
            </div>

            {preprocessInfo && (
              <div className="preprocess-banner">
                <span className="preprocess-icon">⚡</span>
                <span>
                  {(preprocessInfo.changes > 0 || preprocessInfo.locked > 0 || preprocessInfo.transformsBaked > 0 || preprocessInfo.transformsStripped > 0 || preprocessInfo.clipAttrsRemoved > 0 || preprocessInfo.clipDefsRemoved > 0) && (
                    <>
                      Preprocesor:
                      {' '}<strong>{preprocessInfo.changes}</strong> oblastí
                      {preprocessInfo.locked > 0 && (<>, <strong>{preprocessInfo.locked}</strong> obrysov</>)}
                      {preprocessInfo.transformsBaked > 0 && (
                        <>, <strong>{preprocessInfo.transformsBaked}</strong>× translate zapečený</>
                      )}
                      {preprocessInfo.transformsStripped > 0 && (
                        <>, <strong>{preprocessInfo.transformsStripped}</strong>× iný transform odstránený ⚠</>
                      )}
                      {(preprocessInfo.clipAttrsRemoved > 0 || preprocessInfo.clipDefsRemoved > 0) && (
                        <>, <strong>{preprocessInfo.clipAttrsRemoved + preprocessInfo.clipDefsRemoved}</strong>× clipPath odstránený</>
                      )}
                    </>
                  )}
                  {preprocessInfo.svgo && (
                    <>
                      {' '}<span style={{ opacity: 0.5 }}>·</span>{' '}
                      SVGO: <strong>{(preprocessInfo.svgo.before/1024).toFixed(1)}</strong> KB
                      {' → '}<strong>{(preprocessInfo.svgo.after/1024).toFixed(1)}</strong> KB
                      {' ('}
                      {preprocessInfo.svgo.delta >= 0 ? '−' : '+'}
                      {Math.abs(preprocessInfo.svgo.delta/1024).toFixed(1)} KB
                      {')'}
                    </>
                  )}
                </span>
                <button className="banner-close" onClick={() => setPreprocessInfo(null)} aria-label="zavrieť">×</button>
              </div>
            )}

            <div className="lint-list">
              {filteredIssues.length === 0 && (
                <div className="lint-clean">
                  <div className="clean-icon">✓</div>
                  <div className="clean-title">Žiadne problémy</div>
                  <div className="clean-sub">SVG vyzerá v poriadku.</div>
                </div>
              )}
              {filteredIssues.map((issue, i) => (
                <IssueRow
                  key={i}
                  issue={issue}
                  active={selectedIdx === i}
                  expanded={selectedIdx === i}
                  onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                />
              ))}
            </div>

            <div className="lint-footer">
              <button
                className="btn-primary"
                onClick={applyFix}
                disabled={!issues.some(i => i.fixable)}
              >
                Pokúsiť sa opraviť ({issues.filter(i => i.fixable).length})
              </button>
              <button className="btn-secondary" onClick={runSvgo} disabled={svgoRunning} title="Spustí SVGO optimalizáciu — zapečie transformy do path data, odstráni metadata, vyčistí súbor">
                {svgoRunning ? 'SVGO beží…' : 'Spustiť SVGO'}
              </button>
              <button className="btn-secondary" onClick={downloadFixed} title="Vyfarbený obrázok ako PNG (2048×2048, s vašimi farbami)">
                Stiahnuť PNG
              </button>
              <button className="btn-secondary" onClick={downloadClean} title="SVG s vrátenými bielymi oblasťami (bez vašich farieb)">
                Stiahnuť SVG
              </button>
            </div>
          </section>

          {/* PRAVÝ STĹPEC — náhľad + paleta */}
          <section className="preview-pane">
            <div className="preview-header">
              <div className="preview-label">Náhľad &amp; test vyfarbenia</div>
              <div className="preview-hint">Vyber farbu → klikni do oblasti v obrázku</div>
            </div>
            <Palette active={activeColor} onPick={setActiveColor} />
            <div className="preview-frame">
              <SvgPreview
                svgText={svgText}
                activeColor={activeColor}
                onSvgReady={handleSvgReady}
                highlightTarget={highlightTarget}
                onPaint={recountRegions}
              />
            </div>
            <div className="preview-footer">
              <span className="hint-text">
                <span className="kbd">tip</span> kliknutie na chybu vľavo zvýrazní jej element vyššie
              </span>
              <div className="region-counter" title="Vyfarbené oblasti / všetky uzavreté (vyfarbiteľné) oblasti">
                <div className="rc-bar">
                  <div
                    className="rc-fill"
                    style={{ width: regionStats.total ? `${(regionStats.colored / regionStats.total) * 100}%` : '0%' }}
                  />
                </div>
                <span className="rc-text">
                  <strong>{regionStats.colored}</strong>
                  <span className="rc-sep">/</span>
                  {regionStats.total} vyfarbených
                </span>
              </div>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
