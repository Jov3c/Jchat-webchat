# =====================================================================
# JoyChat 一键部署脚本（Windows / 局域网 HTTPS）
#
# 用法：右键此文件 -> "使用 PowerShell 运行"
#       或：powershell -ExecutionPolicy Bypass -File deploy.ps1
#
# 首次运行会自动完成：
#   1. 安装后端依赖（npm ci --omit=dev）
#   2. 安装并构建前端（npm ci --prefix client + npm run build）
#   3. 生成 .env（随机 JWT 密钥 / 私聊加密密钥 / 管理员密码，密码只显示一次）
#   4. 生成 HTTPS 自签证书（自动包含本机局域网 IP）
#   5. 启动 HTTPS 服务
#
# 以后日常启动：双击 deploy/windows/start-joychat.bat
# 重新部署/更新：再次运行本脚本即可（不会覆盖已有的 .env 和证书）
# =====================================================================
# 注意：不要用 'Stop'。PowerShell 5.1 下，原生命令（openssl/npm/node）写 stderr 会被当成终止错误，
# 用 'Continue' 并靠 $LASTEXITCODE 判断成败（下方每一步都已检查）。
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root -ErrorAction Stop

# 捕获任何意外终止错误，给出友好提示
trap {
    Write-Host ""
    Write-Host "[错误] 部署过程中出错：$($_.Exception.Message)" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

# 生成字母数字随机串（避免在 .env 里出现引号/井号等解析问题）
function New-RandomString([int]$length) {
    $alnum = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    -join ((1..$length) | ForEach-Object { $alnum[(Get-Random -Maximum $alnum.Length)] })
}

Write-Host ""
Write-Host "=== JoyChat 一键部署（Windows / 局域网 HTTPS）===" -ForegroundColor Cyan

# ---- 1. 检查 Node.js ----
$nodeVer = & node --version 2>$null
if (-not $nodeVer) {
    Write-Host ""
    Write-Host "[错误] 未检测到 Node.js。" -ForegroundColor Red
    Write-Host "请先安装 Node.js 24 LTS：https://nodejs.org/  （一路默认安装即可）"
    Read-Host "按回车退出"
    exit 1
}
Write-Host ("[1/5] Node.js：{0}" -f $nodeVer) -ForegroundColor Green

# ---- 2. 安装后端依赖 ----
Write-Host "[2/5] 安装后端依赖（首次较慢，请耐心等待）..." -ForegroundColor Yellow
& npm ci --omit=dev
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 后端依赖安装失败" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

# ---- 3. 安装并构建前端 ----
Write-Host "[3/5] 安装前端依赖并构建..." -ForegroundColor Yellow
& npm ci --prefix client
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 前端依赖安装失败" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}
& npm run build --prefix client
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 前端构建失败" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

# ---- 4. 首次生成 .env（密钥 + 管理员密码）----
if (-not (Test-Path "$root\.env")) {
    Write-Host "[4/5] 首次运行，正在生成密钥和管理员密码..." -ForegroundColor Yellow
    $jwtSecret = New-RandomString 48
    $dmKey = -join ((1..64) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
    $adminPassword = (New-RandomString 8) + '-' + (New-RandomString 8)
    $envContent = @"
NODE_ENV=production
JWT_SECRET=$jwtSecret
DM_ENCRYPTION_KEY=$dmKey
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$adminPassword
"@
    [System.IO.File]::WriteAllText("$root\.env", $envContent, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ""
    Write-Host "================ 管理员账号（仅显示一次，请记下）================" -ForegroundColor Green
    Write-Host "  用户名：admin" -ForegroundColor Green
    Write-Host "  密码：  $adminPassword" -ForegroundColor Green
    Write-Host "  （以后忘记可在项目根目录的 .env 文件中查看 ADMIN_PASSWORD）" -ForegroundColor Green
    Write-Host "==================================================================" -ForegroundColor Green
}

# ---- 5. 生成 HTTPS 自签证书（首次）----
$certDir = "$root\deploy\certs"
New-Item -ItemType Directory -Force -Path $certDir -ErrorAction Stop | Out-Null
if (-not (Test-Path "$certDir\server.crt")) {
    Write-Host "[5/5] 正在生成 HTTPS 证书（自动包含本机局域网地址）..." -ForegroundColor Yellow

    # 定位 openssl（系统 PATH 或 Git 自带）
    $openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
    if (-not $openssl) {
        $gitOpenssl = 'C:\Program Files\Git\usr\bin\openssl.exe'
        if (Test-Path $gitOpenssl) { $openssl = $gitOpenssl }
    }
    if (-not $openssl) {
        Write-Host "[错误] 未找到 openssl，请安装 Git（https://git-scm.com/）后重试" -ForegroundColor Red
        Read-Host "按回车退出"
        exit 1
    }

    # 收集本机局域网 IP 作为证书 SAN，浏览器访问这些地址时才不会报"地址不匹配"
    $sans = @('DNS:localhost', 'IP:127.0.0.1')
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.PrefixOrigin -ne 'WellKnown' } |
        ForEach-Object { $sans += "IP:$($_.IPAddress)" }
    $sanList = ($sans | Select-Object -Unique) -join ','

    & $openssl req -x509 -newkey rsa:2048 -sha256 `
        -keyout "$certDir\server.key" `
        -out "$certDir\server.crt" `
        -days 3650 -nodes -subj '/CN=JoyChat' `
        -addext "subjectAltName=$sanList" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$certDir\server.crt")) {
        # 兼容旧版 openssl：退回不含 SAN 的生成
        & $openssl req -x509 -newkey rsa:2048 -sha256 `
            -keyout "$certDir\server.key" `
            -out "$certDir\server.crt" `
            -days 3650 -nodes -subj '/CN=JoyChat' 2>$null
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$certDir\server.crt")) {
        Write-Host "[错误] 证书生成失败" -ForegroundColor Red
        Read-Host "按回车退出"
        exit 1
    }
    Write-Host ("证书已生成：{0}\server.crt" -f $certDir) -ForegroundColor Green
}

# ---- 6. 把证书路径写进 .env（幂等，重复运行不会重复添加）----
$envPath = "$root\.env"
if (Test-Path $envPath) {
    $content = Get-Content -Path $envPath -Raw -ErrorAction Stop
    if (-not $content.EndsWith("`n")) { Add-Content -Path $envPath -Value "" -Encoding ASCII -ErrorAction Stop }
    if ($content -notmatch '(?m)^SSL_CERT_FILE=') {
        Add-Content -Path $envPath -Value "SSL_CERT_FILE=$certDir\server.crt" -Encoding ASCII -ErrorAction Stop
    }
    if ($content -notmatch '(?m)^SSL_KEY_FILE=') {
        Add-Content -Path $envPath -Value "SSL_KEY_FILE=$certDir\server.key" -Encoding ASCII -ErrorAction Stop
    }
}

# ---- 7. 启动 ----
Write-Host ""
Write-Host "部署完成，正在启动 HTTPS 服务..." -ForegroundColor Green
Write-Host "浏览器访问下面的地址（首次会提示“不安全”，点“高级”->“继续前往”即可）：" -ForegroundColor Cyan
Write-Host ""
& node --env-file=.env index.js
