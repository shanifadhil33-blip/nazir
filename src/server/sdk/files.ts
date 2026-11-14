/** The SDK files customers download, with the SHA256 shown next to each link. A test keeps these in sync. */
export const SDK_VERSION = '1.0.0';
export const SDK_FILES = [
  { lang: 'node', path: '/sdk/1.0.0/nazir.mjs', name: 'nazir.mjs', sha256: '812197b62dfeca948062d4369bb3e3abaddb6587502fcd948b5a706f9b38dea1' },
  { lang: 'python', path: '/sdk/1.0.0/nazir.py', name: 'nazir.py', sha256: 'ad25a44cd0742fe2905a169e14f8dabc67a07ad63878ba479cab6ca4f33c6ce6' },
] as const;
