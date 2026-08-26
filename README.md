# Jchat-JoyChat

Jchat-JoyChat 是一个基于 Node.js、Socket.IO 与 SQLite 的实时聊天应用，前端使用 Vue 3 + Vite。支持公共/私有频道、好友私聊（端到端加密）、在线状态、媒体消息与管理后台。

> 当前版本：`v2.4.0`。运行时使用 Node.js 24 LTS（`>=24 <25`）与 npm 11。

## 技术栈（使用语言）

| 层 | 语言 / 技术 | 说明 |
| --- | --- | --- |
| 后端 | **JavaScript**（Node.js 24 LTS，CommonJS） | Express 5 + Socket.IO + SQLite（`node:sqlite`），单进程服务 |
| 前端 | **JavaScript**（Vue 3 组合式 API，ESM） | Vite 8 构建、vue-router 5、响应式 stores（类 Pinia） |
| 数据库 | SQLite（SQL） | Node 24 内置，零外部依赖；`server/data/jchat.sqlite` |
| 样式 | CSS | `client/src/styles/tokens.css`（CSS 变量）+ 组件内 scoped 样式 |
| 密码学 / 安全 | WebCrypto、bcrypt、JWT | 私聊 ECDH P-256 + AES-256-GCM；密码 bcrypt；会话 JWT |
| 测试 | Node test runner + Vitest | 后端 `npm test`，前端 `npm test --prefix client` |

> 全项目为纯 JavaScript（无 TypeScript），代码注释以中文为主。

## 页面预览

### 聊天界面

![Jchat 聊天界面](images/jchat-chat.png)

<details>
<summary>查看更多页面</summary>

### 登录界面

![Jchat 登录界面](images/jchat-login.png)

### 管理后台

![Jchat 管理后台](images/jchat-admin.png)

</details>

## 主要功能

- **实时聊天**：公共/私有频道、好友私聊，消息实时推送。
- **端到端加密（E2EE）**：私聊用 ECDH + AES-256-GCM 加密，服务器只存密文，无法解密（详见下文）。
- **协作功能**：@提及与提醒、历史消息搜索、文件/图片/语音分享、消息回应（表情）、撤回与回复。
- **图片/视频消息**：图片在聊天框直接预览（点击可放大）；浏览器可播放的视频（mp4/webm/mov，≤100MB）内嵌播放器直接看。
- **文件发送**：文档/压缩包/音频等文件存服务器，7 天自动过期清理；下载保留原始文件名。
- **表情与表情包**：输入框表情选择器（常用 emoji 一键插入）；右键图片可收藏为自定义表情包、也可上传本地图片，仅自己可见，添加成功/重复有提示。
- **B 站视频卡片**：消息中粘贴 B 站链接（BV 号），自动渲染可播放的视频卡片。
- **网易云音乐卡片**：消息中粘贴网易云音乐链接，自动渲染带封面的可点音乐卡片（点击唤起 App）；发外链格式（`#/outchain/2/歌曲ID/`）则直接渲染**可播放的内嵌播放器**。
- **消息管理**：未读计数与红点、会话置顶、按最近排序、跳到第一条未读。
- **好友与个人资料**：好友申请与同意、头像上传、资料编辑、在线状态点。
- **频道管理**：创建/邀请（需对方同意）/改名/解散、成员列表与在线状态。
- **管理后台**：用户与频道管理、日志审计。
- **账号安全**：JWT 会话、单会话登录（顶号冻结）、登录/注册/上传限流。
- **界面**：深色模式、响应式三栏布局。

## 端到端加密（E2EE）

私聊采用端到端加密，服务器只存密文，无法解密你的私聊内容：

- 每个用户首次登录时生成一对 ECDH P-256 密钥；私钥用「登录密码派生」的密钥加密后存服务器（服务器只有密码哈希和加密私钥，从不见密码、也不见派生密钥）。
- 双方私聊时用公钥做 ECDH 密钥协商，消息用 AES-256-GCM 加密，服务器只存密文。
- 多设备：任意设备登录输入密码即可恢复私钥和聊天历史，无需扫码授权。
- 改密码时用新密码重锁私钥，历史消息不丢。
- 群聊/频道不加密（保持可搜索、可管理）。

> ⚠️ **必须使用 HTTPS**：端到端加密依赖浏览器 WebCrypto（`crypto.subtle`），它只在安全上下文（`https://` 或 `localhost`）下可用。若通过局域网 IP（如 `http://192.168.x.x:3000`）访问，加密会自动降级为明文（不报错）。正式部署必须配置 HTTPS（哪怕自签证书）。

> 🔑 **密码就是你的私聊钥匙**：私钥由登录密码派生密钥加密，密码强度决定私聊隐私强度。忘记密码或密码被猜到，私聊内容将无法恢复或可能被解密，请务必使用强密码。

旧的服务器端加密私聊消息（`enc:` 前缀）仍可正常显示，新消息一律走 E2EE。

## 部署方式（含 HTTPS）

提供三种部署方式，完整步骤见 [deploy/README.md](deploy/README.md)：

| 方式 | 适用场景 | HTTPS | 难度 |
| --- | --- | --- | --- |
| **Windows 一键脚本**（推荐） | 家里/公司局域网自用 | 自签证书（每台设备首次提示一次） | 双击即可 |
| **Linux 脚本** | 有 Linux 服务器 + 域名，公网对外 | Let's Encrypt 正式证书（Caddy） | 中等 |
| **Docker + Caddy** | 会 Docker，容器化部署 | Let's Encrypt 正式证书 | 中等 |

**Windows 局域网（最快上手）**：双击 `deploy/windows/deploy.ps1`，脚本自动完成「装依赖 → 构建前端 → 生成密钥/管理员密码 → 生成 HTTPS 自签证书 → 启动」。浏览器访问 `https://电脑IP:3000`，首次点「高级 → 继续前往」即可。日常启动用 `deploy/windows/start-joychat.bat`。

> ⚠️ 私聊端到端加密依赖浏览器 WebCrypto，**必须走 HTTPS**（哪怕自签证书）。任何 HTTP 访问都会自动降级为明文（不报错），私聊不再安全。

## 快速开始

### 环境要求

- Node.js 24 LTS（`>=24 <25`；仓库 `.nvmrc` 为 `24`）
- npm 11
- Windows、macOS 或 Linux

### 部署依赖

Jchat-JoyChat 使用单一 Node.js 进程，不依赖 MySQL、PostgreSQL、Redis 或独立前端服务器。SQLite 由 Node.js 24 内置的 `node:sqlite` 提供。

| 组件 | 版本/要求 | 用途 |
| --- | --- | --- |
| Node.js | 24 LTS（`>=24 <25`） | HTTP、SQLite、API 与实时服务运行时 |
| Vue 3 + Vite | `^3.5` / `^8.0` | 前端框架与构建（`client/`） |
| vue-router | `^5.2` | 前端路由 |
| Express | `^5.2` | 页面与 API 服务 |
| Socket.IO | `^4.8.3` | 实时频道和私聊通信（前端 `socket.io-client`） |
| bcrypt | `^6.0.0` | 用户与管理员密码哈希 |
| jsonwebtoken | `^9.0.0` | 登录会话令牌 |
| Multer | `^2.2.0` | 图片、语音和表情包上传 |
| Sharp | `^0.35.3` | 图片压缩与头像处理 |

生产环境建议使用锁文件安装：

```bash
npm ci --omit=dev
npm ci --prefix client
npm run build --prefix client
```

`bcrypt` 和 `sharp` 通常使用预编译二进制；如果目标平台没有对应构建产物，还需要 Python 3、Make 和 C/C++ 编译工具链。应用默认只监听一个 `PORT`（默认 `3000`），公网部署建议由 HTTPS 反向代理转发到该端口。

生产依赖审计当前为 0 项（`npm audit --omit=dev` 与全量 `npm audit` 均为 0 漏洞）。依赖通过 `overrides` 固定到审计安全的版本（如 engine.io 6.6.9、picomatch 2.3.2），并配合消息大小、连接参数与来源限制；CI 会阻断 Critical 级问题。

### 安装与启动

```bash
git clone https://github.com/Jov3c/Jchat-webchat.git
cd Jchat-webchat
npm install                     # 安装后端依赖
npm install --prefix client     # 安装前端依赖
npm run build --prefix client   # 构建前端（生成 client/dist）
npm start                       # 启动服务
```

Jchat-JoyChat 使用单一 Node.js 服务：聊天页面、登录、后台、API 和 Socket.IO 都由 `http://localhost:3000` 提供。后台地址为 `http://localhost:3000/admin`。

> 项目根目录的 `.env` 会被 `npm start` 自动读取（`node --env-file-if-exists=.env`）；也可以用 shell、服务管理器或容器编排注入环境变量。`.env.example` 只是模板。

## 环境变量

| 变量 | 代码默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | 未设置 | 生产部署必须为 `production`。 |
| `PORT` | `3000` | 网页、API 与 Socket.IO 统一服务端口。 |
| `JWT_SECRET` | 开发占位符 | 生产环境必须是至少 32 字符的非默认密钥。 |
| `JWT_EXPIRES_IN` | `30d` | JWT 有效期。 |
| `DM_ENCRYPTION_KEY` | 开发回退（非生产） | 64 位 hex，或至少 32 UTF-8 字节的高强度字符串；生产环境必填。 |
| `ADMIN_USERNAME` | `admin` | 首次初始化的管理员用户名。 |
| `ADMIN_PASSWORD` | `admin123`（仅本地回退） | 首次初始化的管理员密码；生产环境至少 12 字符且不能是默认值。 |
| `JCHAT_ADMIN_CREDENTIALS_FILE` | `server/data/admin_credentials.json` | 管理员 bcrypt 凭据文件路径。 |
| `JCHAT_DB_FILE` | `server/data/jchat.sqlite` | SQLite 数据库路径。 |
| `JCHAT_UPLOADS_DIR` | `public/uploads/` | 仅 `npm run reset-data` 使用的上传目录覆盖项。 |
| `JCHAT_ALLOWED_ORIGINS` | 空 | 逗号分隔的精确 CORS 来源；生产环境请仅配置 HTTPS 域名。 |
| `JCHAT_TRUST_PROXY` | 未设置 | 仅部署在受信任反向代理后设置；可为 `true` 或 Express trust-proxy 值。 |
| `JCHAT_JSON_LIMIT` | `1mb` | JSON 请求体上限。 |
| `JCHAT_URLENCODED_LIMIT` | `100kb` | URL encoded 请求体上限。 |
| `JCHAT_URLENCODED_PARAMETER_LIMIT` | `1000` | URL encoded 参数数量上限。 |
| `JCHAT_RATE_LIMIT_WINDOW_MS` | `900000` | 所有限流器窗口，单位 ms（15 分钟）。 |
| `JCHAT_AUTH_RATE_LIMIT_MAX` | `10` | 登录限流阈值/每 IP/窗口。 |
| `JCHAT_REGISTRATION_RATE_LIMIT_MAX` | `20` | 注册限流阈值/每 IP/窗口。 |
| `JCHAT_ADMIN_RATE_LIMIT_MAX` | `5` | 管理员登录限流阈值/每 IP/窗口。 |
| `JCHAT_UPLOAD_RATE_LIMIT_MAX` | `30` | 上传限流阈值/每 IP/窗口。 |
| `JCHAT_SOCKET_MAX_HTTP_BUFFER_SIZE` | `1000000` | Socket.IO HTTP 缓冲上限，单位字节。 |
| `JCHAT_SOCKET_CONNECT_TIMEOUT_MS` | `20000` | Socket.IO 连接超时，单位 ms。 |
| `JCHAT_SOCKET_PING_TIMEOUT_MS` | `20000` | Socket.IO ping 超时，单位 ms。 |
| `JCHAT_SOCKET_PING_INTERVAL_MS` | `25000` | Socket.IO ping 间隔，单位 ms。 |
| `JCHAT_LOG_DIR` | `server/logs` | 日志目录。 |
| `JCHAT_LOG_RETENTION_DAYS` | `30` | 日志保留天数（有效范围 1–3650）。 |
| `JCHAT_LOG_CHAT_CONTENT` | `false` | 仅设为 `true` 时记录聊天正文；默认仅保留长度和元数据。 |
| `SSL_CERT_FILE` / `SSL_KEY_FILE` | 未设置 | 同时设置（指向 PEM 证书与私钥）时，服务用 HTTPS 监听同一 `PORT`，否则为 HTTP。局域网自用可看 `deploy/README.md` 一键生成自签证书。 |

生成私聊密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 浏览器 API/Socket 配置

单服务部署不需要浏览器端地址配置；页面会自动使用当前地址的 API 和 Socket.IO。只有将页面部署到独立域名时，才需要在页面加载前设置 `API_ORIGIN`：

```html
<script>
  window.API_ORIGIN = 'https://api.example.com';
</script>
```

未设置 `API_ORIGIN` 时，浏览器始终使用页面同源地址。

## 生产部署安全清单

- [ ] 设置 `NODE_ENV=production`。
- [ ] 设置随机 `JWT_SECRET`（至少 32 字符）和独立 `DM_ENCRYPTION_KEY`，并妥善保管；更换 DM 密钥前先规划历史私聊迁移。
- [ ] 首次启动前设置 `ADMIN_PASSWORD` 为至少 12 字符的强密码；不要使用本地默认账号。
- [ ] 使用 HTTPS 反向代理，并在代理层限制公开端口；仅在受信任代理后设置 `JCHAT_TRUST_PROXY`。
- [ ] 使用 `JCHAT_ALLOWED_ORIGINS` 配置精确 HTTPS 域名，避免宽泛或通配符 CORS。
- [ ] 备份 SQLite 数据库、`public/uploads/`、管理员凭据文件和 DM 密钥；DM 密钥丢失会导致相应私聊无法恢复。
- [ ] 保持 `JCHAT_LOG_CHAT_CONTENT=false`，并按合规要求设置日志目录与保留天数。

旧版管理员凭据文件若保存的是明文 `password`，服务首次启动会自动迁移为 bcrypt hash，并以安全权限写回。开发默认账号 `admin/admin123` 仅用于本地首次启动或重置数据；绝不能用于生产。

## 常用命令

```bash
npm start                       # 启动网页、API 和 Socket.IO
npm run dev                     # 监听并重启单一服务
npm test                        # 运行后端自动化测试
npm test --prefix client        # 运行前端自动化测试
npm run build --prefix client   # 构建前端（生成 client/dist）
npm run reset-data              # 清空运行数据并恢复本地默认管理员
```

`reset-data` 会删除用户、频道、消息、好友关系和用户上传内容，同时将普通登录和后台登录的管理员账号统一恢复为 `admin/admin123`（开发环境）。运行前请先备份需要保留的数据。

## 项目结构

```text
Jchat-webchat/
├── client/              # Vue 3 + Vite 前端（源码在 src/，构建产物在 dist/）
│   └── src/
│       ├── api/         # HTTP 与 Socket.IO 客户端
│       ├── components/  # 组件（消息气泡、表情面板、布局等）
│       ├── stores/      # 响应式状态（认证、频道、好友、E2EE、表情包…）
│       ├── utils/       # 工具（B 站链接解析等）
│       ├── views/       # 页面（登录、注册、聊天、资料、管理后台）
│       └── styles/      # 设计令牌与基础样式
├── server/              # 后端模块：数据库、加密、日志、校验、路由、Socket
│   └── data/            # 运行时数据库与管理员凭据（不提交到 Git）
├── public/              # 静态资源与上传：图片、用户上传（uploads 不提交到 Git）
├── tests/               # 后端自动化测试（node --test）
├── scripts/             # 数据重置脚本
├── deploy/              # 部署脚本与指南（windows / linux / docker）
├── images/              # README 界面预览图
├── index.js             # 服务入口（API、静态资源与 Socket.IO，支持可选 HTTPS）
├── Dockerfile           # 容器镜像构建
├── AGENT.md             # 给 AI 开发助手看的项目说明
└── package.json
```

## 数据、备份与测试

- 默认数据库：`server/data/jchat.sqlite`
- 默认上传目录：`public/uploads/`
- 测试命令：`npm test`（后端）、`npm test --prefix client`（前端）
- 不要提交 `.env`、数据库、管理员凭据、日志或上传文件。

## License

MIT
