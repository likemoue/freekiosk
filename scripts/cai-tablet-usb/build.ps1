#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the USB install tool into release-builds\CaiTablet-USB.

.DESCRIPTION
    Compiles with the C# compiler every Windows has, so nothing needs installing, then
    copies adb and the APK next to the program. The result is a folder that runs on any
    Windows 10 or 11 and can be zipped and handed to someone else: what the operator
    enters is stored in their Windows profile, not in the folder.

.PARAMETER Apk
    The APK to ship. Defaults to release-builds\FreeKiosk-*.apk, leaving out the -cloudprovi
    builds: this path can grant WRITE_SECURE_SETTINGS, so it keeps the accessibility service.

.PARAMETER PlatformTools
    Folder holding adb.exe. Defaults to the Android SDK's platform-tools.
#>
[CmdletBinding()]
param(
    [string] $Apk,
    [string] $PlatformTools = (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools')
)

$ErrorActionPreference = 'Stop'

$here   = $PSScriptRoot
$repo   = Resolve-Path (Join-Path $here '..\..')
$output = Join-Path $repo 'release-builds\CaiTablet-USB'
$csc    = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not $Apk) {
    $found = Get-ChildItem (Join-Path $repo 'release-builds\FreeKiosk-*.apk') |
        Where-Object { $_.Name -notmatch 'cloudprovi' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $found) { throw 'No APK in release-builds. Build one with: cd android; ./gradlew assembleRelease' }
    $Apk = $found.FullName
}
foreach ($file in @($csc, $Apk, (Join-Path $PlatformTools 'adb.exe'))) {
    if (-not (Test-Path $file)) { throw "Not found: $file" }
}

New-Item -ItemType Directory -Force (Join-Path $output 'adb') | Out-Null

# An .ico built from the app's own launcher icon, one PNG per size
Add-Type -AssemblyName System.Drawing
$iconPath = Join-Path $env:TEMP 'cai-tablet.ico'
$source   = [System.Drawing.Image]::FromFile((Join-Path $repo 'android\app\src\main\res\mipmap-xxxhdpi\ic_launcher.png'))
$sizes    = 16, 32, 48, 256
$images   = foreach ($size in $sizes) {
    $bitmap   = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $graphics.Dispose()
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    , $stream.ToArray()
}
$source.Dispose()
$writer = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($iconPath))
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $edge = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $writer.Write([byte]$edge); $writer.Write([byte]$edge); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
    $offset += $images[$i].Length
}
foreach ($image in $images) { $writer.Write($image) }
$writer.Close()

$sources = (Get-ChildItem (Join-Path $here '*.cs')).FullName
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/win32icon:$iconPath" `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Security.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll `
    "/out:$(Join-Path $output 'CaiTablet.exe')" $sources
if ($LASTEXITCODE -ne 0) { throw 'Compile failed' }
Remove-Item $iconPath -ErrorAction SilentlyContinue

Copy-Item (Join-Path $PlatformTools 'adb.exe'), (Join-Path $PlatformTools 'AdbWinApi.dll'), (Join-Path $PlatformTools 'AdbWinUsbApi.dll') (Join-Path $output 'adb') -Force
Copy-Item $Apk (Join-Path $output 'FreeKiosk.apk') -Force
Copy-Item (Join-Path $here 'README.md') (Join-Path $output 'HUONG-DAN.txt') -Force

Write-Host "Built $output with $(Split-Path $Apk -Leaf)"
