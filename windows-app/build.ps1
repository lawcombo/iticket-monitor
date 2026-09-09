$ErrorActionPreference = 'Stop'

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryDirectory = Split-Path -Parent $projectDirectory
$sourcePath = Join-Path $projectDirectory 'IticketMonitorWidget.cs'
$outputDirectory = Join-Path $projectDirectory 'dist'
$downloadDirectory = Join-Path $repositoryDirectory 'download'
$temporarySource = Join-Path ([System.IO.Path]::GetTempPath()) ('IticketMonitorWidget-' + [guid]::NewGuid().ToString('N') + '.cs')
$compilerPaths = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$compiler = $compilerPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $compiler) {
    throw '.NET Framework C# 컴파일러를 찾을 수 없습니다.'
}

$utf8 = [System.Text.Encoding]::UTF8
$source = [System.IO.File]::ReadAllText($sourcePath, $utf8)

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $downloadDirectory | Out-Null

try {
    [System.IO.File]::WriteAllText($temporarySource, $source, [System.Text.UTF8Encoding]::new($true))
    & $compiler /nologo /target:winexe /optimize+ /platform:anycpu `
        /reference:System.dll `
        /reference:System.Core.dll `
        /reference:System.Drawing.dll `
        /reference:System.Net.Http.dll `
        /reference:System.Security.dll `
        /reference:System.Web.Extensions.dll `
        /reference:System.Windows.Forms.dll `
        /out:"$outputDirectory\iticket-monitor-widget.exe" `
        "$temporarySource"
    if ($LASTEXITCODE -ne 0) { throw "컴파일 실패: $LASTEXITCODE" }
}
finally {
    Remove-Item -LiteralPath $temporarySource -Force -ErrorAction SilentlyContinue
}

$asciiEncoding = [System.Text.Encoding]::ASCII
foreach ($scriptName in @('install.cmd', 'uninstall.cmd')) {
    $sourcePath = Join-Path $projectDirectory ('package\' + $scriptName)
    $targetPath = Join-Path $outputDirectory $scriptName
    $scriptText = [System.IO.File]::ReadAllText($sourcePath)
    $scriptText = $scriptText -replace "`r?`n", "`r`n"
    [System.IO.File]::WriteAllText($targetPath, $scriptText, $asciiEncoding)
}
Copy-Item -LiteralPath (Join-Path $projectDirectory 'package\README.txt') -Destination $outputDirectory -Force

$zipPath = Join-Path $downloadDirectory 'iticket-monitor-widget-v1.0.1.zip'
Compress-Archive -Path (Join-Path $outputDirectory '*') -DestinationPath $zipPath -Force

Write-Host "EXE: $outputDirectory\iticket-monitor-widget.exe"
Write-Host "ZIP: $zipPath"
