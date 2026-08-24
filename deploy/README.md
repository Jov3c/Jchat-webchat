# 部署与 HTTPS 指南

JoyChat 提供三种部署方式，按你的场景选择：

| 方式 | 适合 | HTTPS | 难度 |
| --- | --- | --- | --- |
| **Windows 一键脚本**（推荐） | 家里/公司局域网，自己和朋友用 | 自签证书 | 双击即可 |
| **Linux 脚本**（可选） | 有 Linux 服务器 + 域名，对外提供 | Let's Encrypt 正式证书 | 中等 |
| **Docker + Caddy**（可选） | 会 Docker，想用容器方式 | Let's Encrypt 正式证书 | 中等 |

> ⚠️ **为什么必须 HTTPS？** JoyChat 的私聊端到端加密依赖浏览器 WebCrypto，它只在 HTTPS（或 localhost）下可用。用 HTTP 访问会自动降级为明文加密，私聊不再安全。

---

## 方式一：Windows 一键部署（局域网，推荐）

### 首次部署
1. 安装 Node.js 24 LTS：https://nodejs.org/ （一路默认即可）
2. 双击 `deploy/windows/deploy.ps1`（或右键 → 使用 PowerShell 运行）
3. 脚本自动完成：装依赖 → 构建前端 → 生成密钥 → 生成 HTTPS 证书 → 启动
4. 看屏幕，**记下管理员账号和密码**（只显示一次）
5. 用浏览器访问启动信息里的地址，例如 `https://192.168.1.5:3000`
   - 首次会提示"不安全/不是私密连接"：点 **高级 → 继续前往** 即可，之后正常使用

### 日常启动
双击 `deploy/windows/start-joychat.bat`。手机/电脑连**同一 Wi-Fi**，浏览器访问 `https://电脑IP:3000`。

### 怎么看电脑的局域网 IP
- 设置 → 网络和 Internet → WLAN / 以太网 → 查看 IPv4 地址
- 或命令行输入 `ipconfig`，看 IPv4 地址

### 更新 / 重新部署
重新双击 `deploy.ps1` 即可（**不会**覆盖已生成的密钥、密码和证书）。

### 其他设备访问时提示证书不安全？
自签证书每台新设备首次访问会提示一次，点"继续访问"即可；之后不再打扰。这是局域网自用最省事的方式，无需买域名和证书。

---

## 方式二：Linux 脚本（公网 + 域名，可选）

前提：一台 Linux 服务器（Debian/Ubuntu），域名已解析到服务器 IP。

```bash
cd deploy/linux
sudo bash deploy.sh            # 或：sudo bash deploy.sh chat.example.com
```

脚本会：装依赖构建 → 生成密钥（密码显示一次）→ 注册 systemd 服务（开机自启、崩溃自动重启）→ 有域名时安装 Caddy 自动申请 **Let's Encrypt 正式证书**。浏览器访问 `https://你的域名`，无任何安全提示。

日常管理：
```bash
systemctl status joychat    # 查看状态
systemctl restart joychat   # 重启
```

---

## 方式三：Docker + Caddy（可选）

前提：服务器已装 Docker 和 docker-compose。

```bash
cd deploy/docker
cp .env.example .env   # 编辑：填密钥、管理员密码和 CADDY_DOMAIN
docker compose up -d --build
```

- 有域名：浏览器访问 `https://你的域名`（Caddy 自动申请正式证书）
- 局域网：`CADDY_DOMAIN` 填服务器 IP，访问 `https://IP`（首次提示点继续）

查看日志：`docker compose logs -f joychat`

---

## HTTPS 一览

| 场景 | HTTPS 方式 | 浏览器提示 |
| --- | --- | --- |
| Windows 局域网 | Node 直接跑自签证书 | 每台设备首次提示一次，点继续 |
| Linux / Docker + 域名 | Caddy + Let's Encrypt 正式证书 | 无提示 |
| Docker 局域网 | Caddy 内部证书 | 每台设备首次提示一次，点继续 |

- 自签证书默认生成在 `deploy/certs/`（**不提交到 Git**）
- 所有密钥在项目根目录 `.env`（Windows/Linux）或 `deploy/docker/.env`（Docker，**不提交到 Git**）
- 正式对外部署前请按项目根目录 README 的「生产部署安全清单」逐项核对
