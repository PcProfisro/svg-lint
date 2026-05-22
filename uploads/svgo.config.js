module.exports = {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          mergePaths: false,
          collapseGroups: false,
          removeViewBox: false,
          cleanupIds: true,
          cleanupNumericValues: { floatPrecision: 2 },
          convertPathData: { 
            floatPrecision: 2,
            applyTransforms: true // Pokus o vnútenie transformácie pre cesty
          }, 
          removeUnknownsAndDefaults: {
            keepDataAttrs: true,
          },
        },
      },
    },
    // Tieto pluginy pridávame explicitne sem, aby sme si boli istí, že zbehnú
    {
      name: 'convertStyleToAttrs',
      active: true
    },
    {
      name: 'convertTransform',
      active: true
    },
    'removeDimensions',
    'removeTitle',
    'removeDesc',
    'removeMetadata',
    'removeComments'
  ],
};