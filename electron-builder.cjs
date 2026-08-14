// APP_EDITION selects which Windows app gets built:
//   plus     (default) -> InterActPlus.exe, with live captions and interpretation.
//   standard           -> InterAct.exe, screenshot interaction only.
// APP_BRAND=viewsonic builds the ViewSonic campaign variant (VSInterAct.exe)
// instead, regardless of edition, with its own appId so it keeps separate
// userData/crash.log from the other two builds.
const edition = process.env.APP_EDITION === 'standard' ? 'standard' : 'plus'
const isViewSonicBrand = process.env.APP_BRAND === 'viewsonic'
const productName = isViewSonicBrand ? 'VSInterAct' : edition === 'standard' ? 'InterAct' : 'InterActPlus'

module.exports = {
  appId: isViewSonicBrand ? 'tw.interact.presenter.viewsonic' : 'tw.interact.presenter.desktop',
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
