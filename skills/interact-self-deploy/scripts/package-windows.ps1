[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^https://[a-z0-9]+\.supabase\.co/?$')]
  [string] $SupabaseUrl,

  [Parameter(Mandatory)]
  [string] $PublishableKey,

  [Parameter(Mandatory)]
  [ValidatePattern('^https://')]
  [string] $PublicAppUrl
)

. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-InterActRoot
$iconPath = Join-Path $root 'build\icon.ico'
$envPath = Join-Path $root '.env'
$output = Join-Path $env:TEMP ("InterAct-package-{0}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$envContent = @"
VITE_SUPABASE_URL=$($SupabaseUrl.TrimEnd('/'))
VITE_SUPABASE_ANON_KEY=$PublishableKey
VITE_PUBLIC_APP_URL=$($PublicAppUrl.TrimEnd('/'))
"@

Push-Location $root
try {
  if (-not (Test-Path -LiteralPath $iconPath)) { throw 'build/icon.ico is missing. Packaging stopped to avoid the default Electron icon.' }
  Write-Utf8NoBom $envPath ($envContent.Trim() + "`n")
  Invoke-Checked 'pnpm.cmd' @('install', '--frozen-lockfile')
  Invoke-Checked 'pnpm.cmd' @('build')
  Invoke-Checked 'pnpm.cmd' @('exec', 'electron-builder', '--win', 'portable', '--x64', "--config.directories.output=$output")

  $source = Join-Path $output 'InterAct.exe'
  if (-not (Test-Path -LiteralPath $source)) { throw 'electron-builder did not produce InterAct.exe.' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $root 'InterAct.exe') -Force
  $result = Get-Item -LiteralPath (Join-Path $root 'InterAct.exe')
  $hash = Get-FileHash -LiteralPath $result.FullName -Algorithm SHA256
  [pscustomobject]@{
    FullName = $result.FullName
    Length = $result.Length
    FileVersion = $result.VersionInfo.FileVersion
    SHA256 = $hash.Hash
    LastWriteTime = $result.LastWriteTime
  }
} finally {
  Pop-Location
}
