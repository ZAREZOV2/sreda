param(
    [Parameter(Mandatory = $true)]
    [string[]] $Files
)
$ErrorActionPreference = "Stop"

# The release pipeline is usable without a certificate; partial setup is an error.
$certificate = $env:SREDA_SIGN_CERT_PFX
$password = $env:SREDA_SIGN_CERT_PASSWORD
if ([string]::IsNullOrWhiteSpace($certificate) -and [string]::IsNullOrWhiteSpace($password)) {
    Write-Host "Сертификат подписи не настроен — шаг пропущен."
    exit 0
}
if ([string]::IsNullOrWhiteSpace($certificate) -or [string]::IsNullOrWhiteSpace($password)) {
    throw "Для подписи нужны оба секрета: SREDA_SIGN_CERT_PFX и SREDA_SIGN_CERT_PASSWORD"
}

$sdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits/10/bin"
$signtool = Get-ChildItem $sdkRoot -Recurse -Filter signtool.exe -File |
    Where-Object { $_.FullName -match '[\\/]x64[\\/]signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $signtool) { throw "signtool.exe не найден в Windows SDK" }

$pfx = Join-Path $env:RUNNER_TEMP "sreda-signing.pfx"
try {
    [System.IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($certificate))
    foreach ($file in $Files) {
        if (-not (Test-Path $file -PathType Leaf)) { throw "Не найден файл для подписи: $file" }
        & $signtool.FullName sign /fd SHA256 /f $pfx /p $password /tr http://timestamp.digicert.com /td SHA256 $file
        if ($LASTEXITCODE -ne 0) { throw "Ошибка подписи $file (exit $LASTEXITCODE)" }
    }
} finally {
    Remove-Item $pfx -Force -ErrorAction SilentlyContinue
}
