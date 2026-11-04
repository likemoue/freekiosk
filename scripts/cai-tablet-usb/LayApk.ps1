#Requires -Version 5.1
<#
.SYNOPSIS
    Lấy đủ bộ APK của một ứng dụng từ máy Android đang cắm, gom thành một tệp .zip để tải lên website.

.DESCRIPTION
    Ứng dụng cài từ CH Play gồm nhiều tệp: base.apk và các tệp split_config theo CPU, độ phân giải
    màn hình, ngôn ngữ. Công cụ trích xuất APK trên điện thoại thường chỉ lấy base.apk, và Android
    không cài được tệp đó một mình. Công cụ này lấy đủ các tệp bằng adb.

    Chạy không tham số để chọn ứng dụng trong danh sách. Máy cần bật Gỡ lỗi USB.

.PARAMETER Package
    Tên gói, ví dụ ismart.edu.vn.ipro. Bỏ trống thì hiện danh sách để chọn.

.PARAMETER Serial
    Số serial của máy, khi đang cắm nhiều máy.

.PARAMETER Output
    Thư mục lưu tệp .zip. Mặc định là thư mục hiện tại.

.PARAMETER Adb
    Đường dẫn tới adb.exe. Mặc định dùng adb đi kèm công cụ, rồi tới adb trong Android SDK.
#>
[CmdletBinding()]
param(
    [string] $Package,
    [string] $Serial,
    [string] $Output = (Get-Location).Path,
    [string] $Adb
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Adb) {
    $Adb = @(
        (Join-Path $PSScriptRoot 'adb\adb.exe'),
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe')
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $Adb) { throw 'Không tìm thấy adb.exe.' }
}

function Invoke-Adb {
    $target = if ($Serial) { @('-s', $Serial) } else { @() }
    # adb writes its progress to stderr, which is no failure: only the exit code says so
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = & $Adb @target @args 2>&1 | ForEach-Object { "$_".TrimEnd("`r") }
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($LASTEXITCODE -ne 0) { throw "adb $($args -join ' '): $($lines -join ' ')" }
    return $lines
}

if (-not $Serial) {
    $connected = @(Invoke-Adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\S+\s+device\b' } | ForEach-Object { ($_ -split '\s+')[0] })
    if ($connected.Count -eq 0) { throw 'Chưa có máy nào sẵn sàng. Cắm cáp, bật Gỡ lỗi USB rồi chọn Cho phép trên máy.' }
    if ($connected.Count -gt 1) { throw "Đang cắm nhiều máy, hãy chọn một bằng -Serial: $($connected -join ', ')" }
    $Serial = $connected[0]
}

if (-not $Package) {
    $packages = @(Invoke-Adb shell pm list packages -3 | ForEach-Object { $_ -replace '^package:', '' } | Where-Object { $_ } | Sort-Object)
    if ($packages.Count -eq 0) { throw 'Máy này không có ứng dụng nào do người dùng cài.' }
    for ($i = 0; $i -lt $packages.Count; $i++) { Write-Host ('{0,3}. {1}' -f ($i + 1), $packages[$i]) }
    $choice = Read-Host 'Nhập số thứ tự của ứng dụng cần lấy'
    $index = 0
    if (-not [int]::TryParse($choice, [ref] $index) -or $index -lt 1 -or $index -gt $packages.Count) { throw 'Số thứ tự không hợp lệ.' }
    $Package = $packages[$index - 1]
}

try {
    $remote = @(Invoke-Adb shell pm path $Package | Where-Object { $_ -like 'package:*' } | ForEach-Object { $_ -replace '^package:', '' })
} catch {
    throw "Máy này chưa cài $Package."
}
if ($remote.Count -eq 0) { throw "Máy này chưa cài $Package." }

$dump = Invoke-Adb shell dumpsys package $Package
$version = ($dump | Select-String -Pattern 'versionName=(\S+)' | Select-Object -First 1).Matches[0].Groups[1].Value

$work = Join-Path $env:TEMP "LayApk-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force $work | Out-Null
try {
    foreach ($path in $remote) {
        Write-Host "Đang lấy $(Split-Path -Leaf $path)..."
        Invoke-Adb pull $path (Join-Path $work (Split-Path -Leaf $path)) | Out-Null
    }
    New-Item -ItemType Directory -Force $Output | Out-Null
    $zip = Join-Path $Output "$Package-$version.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $work '*.apk') -DestinationPath $zip
    Write-Host ''
    Write-Host "Xong: $zip ($($remote.Count) tệp)"
    Write-Host 'Tải tệp này lên mục Ứng dụng (APK) trên website.'
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
