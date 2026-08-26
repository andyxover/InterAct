module.exports = {
  appId: 'tw.interact.presenter.desktop',
  productName: 'InterAct',
  artifactName: `InterAct.\${ext}`,
  directories: {
    output: 'release',
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'package.json',
    // package.json's dependencies are renderer-only libraries already
    // bundled into dist/**/*.js by Vite; electron/*.cjs only requires
    // electron/node:path/node:fs, so none of node_modules ever runs.
    '!node_modules/**/*',
  ],
  // The UI only ships zh-TW and en-US strings; without this, electron-builder
  // bundles all ~55 Chromium locale .pak files (~49MB of unused languages).
  electronLanguages: ['en-US', 'zh-TW'],
  extraResources: [
    {
      from: 'build/icon.ico',
      to: 'icon.ico',
    },
  ],
  mac: {
    // electron-builder generates the .icns from this PNG automatically.
    icon: 'build/icon.png',
    category: 'public.app-category.education',
    // Local unsigned build; skip code signing so packaging works without an
    // Apple Developer identity in the keychain.
    identity: null,
    target: [
      {
        target: 'dmg',
        arch: ['arm64'],
      },
    ],
  },
  win: {
    icon: 'build/icon.ico',
    executableName: 'InterAct',
    requestedExecutionLevel: 'asInvoker',
    target: [
      {
        target: 'portable',
        arch: ['x64'],
      },
      // Unlike portable, which re-extracts its full payload to a temp folder
      // on every launch (~10s), this zip is unpacked once and the exe inside
      // then starts directly (~2s) on every subsequent run.
      {
        target: 'zip',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    allowElevation: false,
    installerIcon: 'build/icon.ico',
    installerHeaderIcon: 'build/icon.ico',
    packElevateHelper: false,
    perMachine: false,
    uninstallerIcon: 'build/icon.ico',
  },
  portable: {
    requestExecutionLevel: 'user',
  },
}
