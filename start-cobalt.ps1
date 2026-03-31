Param(
    [string]$RepoPath = "C:\Users\Patri\cobalt",
    [string]$ApiUrl   = "http://localhost:9000/",
    [string]$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe",
    [string]$CometPath = "C:\Users\Patri\AppData\Local\Perplexity\Comet\Application\comet.exe"
)

$ErrorActionPreference = "Stop"

function Wait-ForLocalPort {
    Param(
        [string]$HostName,
        [int]$Port,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        try {
            $async = $tcpClient.BeginConnect($HostName, $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(500) -and $tcpClient.Connected) {
                $tcpClient.EndConnect($async) | Out-Null
                return $true
            }
        } catch {
            # server not ready yet
        } finally {
            $tcpClient.Close()
        }
        Start-Sleep -Milliseconds 400
    }

    return $false
}

Write-Host "=> Kontrola repozitáře v $RepoPath"

if (-not (Test-Path $RepoPath)) {
    Write-Host "=> Složka neexistuje, vytvářím ji..."
    New-Item -ItemType Directory -Path $RepoPath | Out-Null
    Write-Host "=> Složka vytvořena, ale repo není naklonované!"
    Write-Host "   Udělej ručně (jednou):"
    Write-Host "   git clone https://github.com/imputnet/cobalt `"$RepoPath`""
    return
}

Write-Host "=> Repozitářový adresář existuje, pokračuju..."

# 1) pnpm
Write-Host "=> Kontrola pnpm..."
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    Write-Host "=> pnpm nenalezen, instaluju přes npm..."
    & "C:\Program Files\nodejs\npm.cmd" install -g pnpm
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpm) {
        throw "pnpm se nepodařilo nainstalovat (zkontroluj práva / PATH)."
    }
} else {
    Write-Host "=> pnpm už je nainstalovaný."
}

# 2) API část
$apiPath = Join-Path $RepoPath "api"
if (-not (Test-Path $apiPath)) {
    throw "Adresář 'api' nebyl nalezen v $RepoPath – jsi v rootu správného repa?"
}

Write-Host "=> Instalace dependencí pro API..."
Set-Location $apiPath
pnpm install

$envFile = Join-Path $apiPath ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "=> Vytvářím .env pro API..."
    @(
        "API_URL=$ApiUrl"
    ) | Set-Content -Encoding UTF8 $envFile
} else {
    Write-Host "=> .env pro API už existuje, neupravuju."
}

Write-Host "=> Start API (pnpm start)..."
Start-Process pnpm "start" -WorkingDirectory $apiPath

# 3) WEB část (SvelteKit frontend)
$webPath = Join-Path $RepoPath "web"
if (Test-Path $webPath) {
    Write-Host "=> Instalace dependencí pro web..."
    Set-Location $webPath
    pnpm install

    $webEnv = Join-Path $webPath ".env"
    if (-not (Test-Path $webEnv)) {
        Write-Host "=> Vytvářím .env pro web..."
        @(
            "VITE_API_URL=$ApiUrl"
        ) | Set-Content -Encoding UTF8 $webEnv
    } else {
        Write-Host "=> .env pro web už existuje, neupravuju."
    }

    Write-Host "=> Start web UI (pnpm dev, bez auto-open browseru)..."
    Start-Process pnpm "dev -- --open=false" -WorkingDirectory $webPath

    $webHttpsUrl = "https://localhost:5173/"
    $webHttpUrl = "http://localhost:5173/"
    Write-Host "=> Čekám na Vite server na localhost:5173..."
    $serverReady = Wait-ForLocalPort -HostName "127.0.0.1" -Port 5173 -TimeoutSeconds 45
    if (-not $serverReady) {
        Write-Host "=> Vite na 5173 zatím neodpovídá, zkusím otevřít browser i tak."
    }

    if (Test-Path $ChromePath) {
        Write-Host "=> Otevírám web v Chrome: $webHttpsUrl"
        Start-Process -FilePath $ChromePath -ArgumentList @("--new-window", "--ignore-certificate-errors", $webHttpsUrl)
    } elseif (Test-Path $CometPath) {
        Write-Host "=> Chrome nenalezen, otevírám web v Comet: $webHttpsUrl"
        Start-Process -FilePath $CometPath -ArgumentList $webHttpsUrl
    } else {
        Write-Host "=> Chrome ani Comet nenalezen, přeskočeno otevření browseru."
    }

    Start-Sleep -Seconds 1
    if (Test-Path $ChromePath) {
        Write-Host "=> Fallback otevírám i HTTP variantu: $webHttpUrl"
        Start-Process -FilePath $ChromePath -ArgumentList @("--new-window", $webHttpUrl)
    }
} else {
    Write-Host "=> Adresář 'web' nebyl nalezen, web UI nespouštím."
}

Write-Host "Hotovo. API by mělo běžet na $ApiUrl a web dev typicky na http://localhost:5173 nebo 3000."