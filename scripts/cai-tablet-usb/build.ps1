#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the USB install tool into release-builds\CaiTablet-USB, and the archive it updates itself from.

.DESCRIPTION
    Compiles with the C# compiler every Windows has, so nothing needs installing, then
    copies adb and the APK next to the program. The result is a folder that runs on any
    Windows 10 or 11 and can be zipped and handed to someone else: what the operator
    enters is stored in their Windows profile, not in the folder.

    Each build is a version, the time it was made (yyyy.MM.dd.HHmm), and also comes out as
    release-builds\CaiTablet-USB-<version>.zip. Uploaded on the website (APK page, tab
    Cong cu cai USB), it reaches every copy of the tool the next time it opens. The archive
    lists its files in phien-ban.json, signed with the key in khoa-ky-cap-nhat.xml next to
    this script: the tool takes nothing that key did not sign, so a website taken over cannot
    hand out a program of its own. Keep that file safe, like the APK keystore: a build signed
    with another key reaches no copy already out there.

.PARAMETER Apk
    The APK to ship. Defaults to release-builds\FreeKiosk-*.apk, leaving out the -cloudprovi
    builds: this path can grant WRITE_SECURE_SETTINGS, so it keeps the accessibility service.

.PARAMETER PlatformTools
    Folder holding adb.exe. Defaults to the Android SDK's platform-tools.

.PARAMETER SigningKey
    The private key the archive is signed with. Defaults to khoa-ky-cap-nhat.xml next to this script.

.PARAMETER NewSigningKey
    Makes that key, the first time only. Copies built with another key never update to this build.
#>
[CmdletBinding()]
param(
    [string] $Apk,
    [string] $PlatformTools = (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools'),
    [string] $SigningKey = (Join-Path $PSScriptRoot 'khoa-ky-cap-nhat.xml'),
    [switch] $NewSigningKey
)

$ErrorActionPreference = 'Stop'

$here    = $PSScriptRoot
$repo    = Resolve-Path (Join-Path $here '..\..')
$builds  = Join-Path $repo 'release-builds'
$output  = Join-Path $builds 'CaiTablet-USB'
$csc     = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$version = Get-Date -Format 'yyyy.MM.dd.HHmm'
$utf8    = New-Object System.Text.UTF8Encoding $false

if (-not $Apk) {
    $found = Get-ChildItem (Join-Path $builds 'FreeKiosk-*.apk') |
        Where-Object { $_.Name -notmatch 'cloudprovi' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $found) { throw 'No APK in release-builds. Build one with: cd android; ./gradlew assembleRelease' }
    $Apk = $found.FullName
}
foreach ($file in @($csc, $Apk, (Join-Path $PlatformTools 'adb.exe'))) {
    if (-not (Test-Path $file)) { throw "Not found: $file" }
}

# The signing key: made once, on purpose, never again by accident
if (-not (Test-Path $SigningKey)) {
    if (-not $NewSigningKey) {
        throw "No signing key at $SigningKey. Restore it from your backup, or run once with -NewSigningKey (copies of the tool built with another key will not take this build)."
    }
    $made = New-Object System.Security.Cryptography.RSACng 3072
    [System.IO.File]::WriteAllText($SigningKey, $made.ToXmlString($true), $utf8)
    $made.Dispose()
    Write-Warning "Made a new signing key at $SigningKey. Back it up with the APK keystore."
}
$rsa = New-Object System.Security.Cryptography.RSACng
$rsa.FromXmlString([System.IO.File]::ReadAllText($SigningKey))
$publicKey = $rsa.ToXmlString($false)

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

# The version and the public half of the key, in place of PhienBan.cs
$stamp = Join-Path $env:TEMP 'cai-tablet-phien-ban.cs'
[System.IO.File]::WriteAllText($stamp, @"
namespace CaiTablet
{
    static class PhienBan
    {
        public const string Hien = "$version";
        public const string KhoaCongKhai = @"$publicKey";
    }
}
"@, $utf8)

$sources = @((Get-ChildItem (Join-Path $here '*.cs') | Where-Object { $_.Name -ne 'PhienBan.cs' }).FullName) + $stamp
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/win32icon:$iconPath" `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Security.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll `
    /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
    "/out:$(Join-Path $output 'CaiTablet.exe')" $sources
if ($LASTEXITCODE -ne 0) { throw 'Compile failed' }
Remove-Item $iconPath, $stamp -ErrorAction SilentlyContinue

Copy-Item (Join-Path $PlatformTools 'adb.exe'), (Join-Path $PlatformTools 'AdbWinApi.dll'), (Join-Path $PlatformTools 'AdbWinUsbApi.dll') (Join-Path $output 'adb') -Force
Copy-Item $Apk (Join-Path $output 'FreeKiosk.apk') -Force
Copy-Item (Join-Path $here 'README.md') (Join-Path $output 'HUONG-DAN.txt') -Force
Copy-Item (Join-Path $here 'LayApk.ps1'), (Join-Path $here 'LayApk.bat') $output -Force

# What the tool checks an update by: every file with its SHA-256, and the list signed. Both go into the
# archive only: left in the folder, they would still name this build after an update
Remove-Item (Join-Path $output 'phien-ban.json'), (Join-Path $output 'phien-ban.sig') -ErrorAction SilentlyContinue
$listPath      = Join-Path $env:TEMP 'cai-tablet-phien-ban.json'
$signaturePath = Join-Path $env:TEMP 'cai-tablet-phien-ban.sig'
$apkVersion = if ((Split-Path $Apk -Leaf) -match '^FreeKiosk-(.+?)\.apk$') { $Matches[1] } else { $null }
# Named one by one: whatever else lies in the folder (a test, an old update) stays out
$shipped = 'CaiTablet.exe', 'FreeKiosk.apk', 'HUONG-DAN.txt', 'LayApk.ps1', 'LayApk.bat', 'adb/adb.exe', 'adb/AdbWinApi.dll', 'adb/AdbWinUsbApi.dll'
$files = foreach ($name in $shipped) {
    $file = Get-Item (Join-Path $output $name)
    [ordered]@{
        path   = $name
        sha256 = (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        size   = $file.Length
    }
}
$list = [ordered]@{ version = $version; apkVersion = $apkVersion; files = @($files) } | ConvertTo-Json -Depth 4
$listBytes = $utf8.GetBytes($list)
[System.IO.File]::WriteAllBytes($listPath, $listBytes)
$signature = $rsa.SignData($listBytes, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
[System.IO.File]::WriteAllText($signaturePath, [Convert]::ToBase64String($signature), $utf8)
$rsa.Dispose()

# The archive for the website. The names inside use /, as the tool and the website read them
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Get-ChildItem (Join-Path $builds 'CaiTablet-USB-*.zip') | Remove-Item
$archive = Join-Path $builds "CaiTablet-USB-$version.zip"
$zip = [System.IO.Compression.ZipFile]::Open($archive, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($name in $shipped) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $output $name), $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $listPath, 'phien-ban.json') | Out-Null
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $signaturePath, 'phien-ban.sig') | Out-Null
} finally {
    $zip.Dispose()
}
Remove-Item $listPath, $signaturePath -ErrorAction SilentlyContinue

Write-Host "Built $output, version $version, with $(Split-Path $Apk -Leaf)"
Write-Host "Archive for the website: $archive"
