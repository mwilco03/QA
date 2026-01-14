# QA Console Scripts - PowerShell Installer
# Copy script to clipboard for pasting into browser console

param(
    [ValidateSet('lms', 'storyline', 'tla', 'unified', 'data')]
    [string]$Script = 'lms'
)

$scripts = @{
    'lms'       = 'lms-extractor-complete.min.js'
    'storyline' = 'storyline-console-extractor.min.js'
    'tla'       = 'tla-completion-helper.min.js'
    'unified'   = 'unified-qa-extractor.min.js'
    'data'      = 'storyline-data-extractor.min.js'
}

$base = 'https://raw.githubusercontent.com/mwilco03/QA/main/dist/'
$url = $base + $scripts[$Script]

try {
    $content = Invoke-RestMethod -Uri $url
    $content | Set-Clipboard
    Write-Host "Copied $($scripts[$Script]) to clipboard. Paste into browser console." -ForegroundColor Green
} catch {
    Write-Host "Failed to fetch script: $_" -ForegroundColor Red
}
