#!/usr/bin/env bash
# =====================================================================
# JoyChat 一键部署（Linux / systemd 开机自启 + Caddy 公网 HTTPS）
#
# 用法：sudo bash deploy.sh
#   可选：sudo bash deploy.sh chat.example.com   （直接指定域名）
#   或运行后按提示输入域名；留空则只本机运行，不配公网。
#
# 脚本会自动：
#   1. 安装后端依赖并构建前端
#   2. 生成 .env（密钥 + 管理员密码，密码只显示一次）
#   3. 注册 systemd 服务（开机自启、崩溃自动重启）
#   4. 有域名时安装 Caddy，自动申请 Let's Encrypt 正式 HTTPS 证书
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "=== JoyChat 一键部署（Linux）==="

# ---- 1. Node.js ----
if ! command -v node >/dev/null 2>&1; then
    echo "[错误] 未检测到 Node.js。请先安装 Node.js 24 LTS："
    echo "       官网 https://nodejs.org/  或  https://github.com/nodesource/distributions"
    exit 1
fi
echo "[1/5] Node.js：$(node --version)"

# ---- 2. 依赖 + 构建前端 ----
echo "[2/5] 安装后端依赖..."
npm ci --omit=dev
echo "      安装前端依赖并构建..."
npm ci --prefix client
npm run build --prefix client

# ---- 3. .env（首次）----
if [ ! -f "$ROOT/.env" ]; then
    echo "[3/5] 首次运行，生成密钥和管理员密码..."
    JWT_SECRET="$(openssl rand -base64 40 | tr -dc 'A-Za-z0-9' | head -c 48)"
    DM_KEY="$(openssl rand -hex 32)"
    ADMIN_PW="$(openssl rand -base64 16 | tr -dc 'A-Za-z0-9' | head -c 12)"
    cat > "$ROOT/.env" <<EOF
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
DM_ENCRYPTION_KEY=$DM_KEY
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PW
EOF
    echo ""
    echo "================ 管理员账号（仅显示一次，请记下）================"
    echo "  用户名：admin"
    echo "  密码：  $ADMIN_PW"
    echo "  （以后忘记可在项目根目录 .env 文件查看 ADMIN_PASSWORD）"
    echo "================================================================"
fi

# ---- 4. 域名（决定是否配置 Caddy 公网 HTTPS）----
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
    read -rp "[4/5] 请输入你的域名（如 chat.example.com，用于正式 HTTPS；直接回车则跳过公网配置）: " DOMAIN
fi

# ---- 5. systemd 服务 ----
echo "[5/5] 注册 systemd 服务（开机自启）..."
SERVICE_NAME="joychat"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_BIN="$(command -v node)"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=JoyChat
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=$NODE_BIN --env-file=$ROOT/.env $ROOT/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
systemctl restart "$SERVICE_NAME"

# ---- 6. Caddy 公网 HTTPS（可选）----
if [ -n "$DOMAIN" ]; then
    echo "      配置 Caddy + Let's Encrypt（域名：$DOMAIN）..."
    if ! command -v caddy >/dev/null 2>&1; then
        apt-get update -y
        apt-get install -y caddy
    fi
    cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
EOF
    # 反向代理场景下浏览器来源端口与后端不同，需显式放行该来源
    if grep -q '^JCHAT_ALLOWED_ORIGINS=' "$ROOT/.env"; then
        sed -i "s|^JCHAT_ALLOWED_ORIGINS=.*|JCHAT_ALLOWED_ORIGINS=https://$DOMAIN|" "$ROOT/.env"
    else
        echo "JCHAT_ALLOWED_ORIGINS=https://$DOMAIN" >> "$ROOT/.env"
    fi
    systemctl restart "$SERVICE_NAME"
    systemctl enable caddy >/dev/null 2>&1
    systemctl restart caddy
    echo ""
    echo "访问：https://$DOMAIN"
else
    echo ""
    echo "未配置域名。服务已在本机运行：http://localhost:3000"
    echo "（如需公网 HTTPS，请重新运行脚本并输入域名）"
fi

echo ""
echo "部署完成！服务状态："
systemctl status "$SERVICE_NAME" --no-pager | head -8
