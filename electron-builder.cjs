// APP_EDITION selects which Windows app gets built:
//   plus     (default) -> InterActPlus.exe, with live captions and interpretation.
//   standard           -> InterAct.exe, screenshot interaction only.
const edition = process.env.APP_EDITION === 'standard' ? 'standard' : 'plus'
const productName = edition === 'standard' ? 'InterAct' : 'InterActPlus'

module.exports = {
  appId: 'tw.interact.presenter.desktop',
  productName,
  artifactName: `${productName}.\${ext}`,
  directories: {
    output: 'release',
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'package.json',
  ],
  extraResources: [
    {
      from: 'build/icon.ico',
      to: 'icon.ico',
    },
  ],
  win: {
    icon: 'build/icon.ico',
    executableName: productName,
    requestedExecutionLevel: 'asInvoker',
    target: [
      {
        target: 'portable',
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
