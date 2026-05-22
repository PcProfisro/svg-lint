module.exports = {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // KĽÚČOVÉ ZMENY:
          collapseGroups: true,      // posunie transform z <g> na deti
          moveGroupAttrsToElems: true, // pomocná - dá transform na elementy
          convertTransform: {
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
          convertPathData: {
            floatPrecision: 2,
            applyTransforms: true,         // zapečie transform do d="..."
            applyTransformsStroked: true,  // aj keď path má stroke
            makeArcs: { threshold: 2.5, tolerance: 0.5 },
            // OPRAVA: Zabráni odstraňovaniu "z" a iných bodov, ktoré SVGO považuje za zbytočné
            removeUseless: false,
          },
          // ZACHOVÁ pôvodné správanie:
          mergePaths: false,           // nezlúči cesty
          removeViewBox: false,        // zachovaj viewBox
          cleanupIds: true,
          cleanupNumericValues: { floatPrecision: 2 },
          removeUnknownsAndDefaults: {
            keepDataAttrs: true,       // zachovaj data-region, data-locked
          },
        },
      },
    },
    'removeDimensions',
    'removeTitle',
    'removeDesc',
    'removeMetadata',
    'removeComments',
  ],
};