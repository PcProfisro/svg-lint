// svgo-runner.js — wrapper okolo SVGO 3.x browser ESM
// SVGO 3.x sa do prehliadača načíta ako ES modul cez esm.sh.
// Konfigurácia OBÍDUC preset-default, lebo niektoré pluginy v preset-default
// používajú css-tree, ktorý v esm.sh bundle padá chybou
// "Missed structure field in String node type definition".

(function () {
  'use strict';

  // Manuálny zoznam pluginov — len tie, ktoré nepoužívajú css-tree.
  // Vynechané: inlineStyles, minifyStyles, removeUselessStrokeAndFill,
  // convertColors (kvôli isteote), prefixIds, sortAttrs.
  const CONFIG = {
    multipass: true,
    plugins: [
      'removeDoctype',
      'removeXMLProcInst',
      'removeComments',
      'removeMetadata',
      'removeEditorsNSData',
      'cleanupAttrs',
      'removeUselessDefs',
      'cleanupNumericValues',
      'removeEmptyAttrs',
      'removeEmptyContainers',
      'removeEmptyText',
      'removeHiddenElems',
      'removeUnknownsAndDefaults',
      'removeNonInheritableGroupAttrs',
      'cleanupEnableBackground',
      'convertEllipseToCircle',
      'moveElemsAttrsToGroup',
      // KĽÚČOVÉ — zapečenie transformov
      'moveGroupAttrsToElems',
      'collapseGroups',
      {
        name: 'convertTransform',
        params: {
          convertToShorts: true,
          floatPrecision: 3,
          transformPrecision: 5,
          matrixToTransform: true,
          shortTranslate: true,
          shortScale: true,
          shortRotate: true,
          removeUseless: true,
          collapseIntoOne: true,
        },
      },
      {
        name: 'convertPathData',
        params: {
          floatPrecision: 2,
          applyTransforms: true,
          applyTransformsStroked: true,
          makeArcs: { threshold: 2.5, tolerance: 0.5 },
          removeUseless: false, // zachovaj Z koncovky
        },
      },
      {
        name: 'cleanupIds',
        params: { remove: true, minify: true },
      },
      // EXPLICITNE vypnuté: mergePaths (chceme samostatné regióny)
      'removeDimensions',
      'removeTitle',
      'removeDesc',
    ],
  };

  let svgoModule = null;
  let loadingPromise = null;

  async function ensureLoaded() {
    if (svgoModule) return svgoModule;
    if (loadingPromise) return loadingPromise;
    loadingPromise = import('https://esm.sh/svgo@3.3.2')
      .then((mod) => { svgoModule = mod; return mod; })
      .catch((e) => { loadingPromise = null; throw e; });
    return loadingPromise;
  }

  async function run(svgText, customConfig) {
    try {
      const mod = await ensureLoaded();
      if (!mod || typeof mod.optimize !== 'function') {
        return { ok: false, error: 'SVGO modul sa načítal, ale chýba funkcia optimize.' };
      }
      const before = svgText.length;
      const result = mod.optimize(svgText, customConfig || CONFIG);
      const after = result.data.length;
      return {
        ok: true,
        text: result.data,
        bytesBefore: before,
        bytesAfter: after,
      };
    } catch (e) {
      return {
        ok: false,
        error: (e && (e.message || String(e))) ||
               'SVGO nedostupný (skontrolujte sieťové pripojenie k esm.sh).',
      };
    }
  }

  window.SvgoRunner = { run, ensureLoaded, CONFIG };
})();
