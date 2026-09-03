# AGENT.md — 给 AI 开发助手看的项目说明

本文件为 AI 开发助手（Claude、Cursor 等）提供本项目（Jchat-JoyChat）的关键信息。改动代码前请先读本文件，尤其是「开发约定」「安全模型」两节。

## 项目简介

Jchat-JoyChat 是一个实时聊天应用：公共/私有频道 + 好友私聊（**端到端加密**）+ 在线状态 + 媒体消息 + 管理后台。

- 单 Node.js 进程同时提供：网页、HTTP API、Socket.IO 实时通信、SQLite 数据库
- 前端为 Vue 3 单页应用，构建产物 `client/dist/` 由同一服务托管
- 当前版本：**v2.5.0**；要求 **Node.js 24 LTS**（`node:sqlite`、`--env-file` 均依赖 Node ≥20/24）

## 技术栈（使用语言）

- **纯 JavaScript**（无 TypeScript）。后端 CommonJS，前端 ESM。注释以中文为主。
- 后端：Express 5、Socket.IO 4、SQLite（`node:sqlite`）、bcrypt、jsonwebtoken、multer、sharp、cors
- 前端：Vue 3（组合式 API）、Vite 8、vue-router 5、vitest 4、@vue/test-utils；无 Pinia，用「reactive 对象 store」模式
- 样式：`client/src/styles/tokens.css`（CSS 变量）+ 组件 scoped 样式；支持深色模式
- 测试：后端 `node --test`（Node 内置），前端 Vitest + jsdom

## 仓库结构

```
├── client/              # Vue 3 前端
│   └── src/
│       ├── api/         # http.js（fetch 封装）、socket.js（Socket.IO 客户端）
│       ├── components/  # Avatar、MessageBubble、StickerPicker、MusicCard、Toast、ImageLightbox、layout/（Composer、MessageList…）
│       ├── stores/      # reactive stores：auth、channels、e2ee、friends、keys、navigation、presence、session、stickers、unread、userCard、toast、imageViewer
│       ├── utils/       # bilibili.js（B站→播放器）、music.js（网易云→音乐卡片/外链播放器）、notify.js（桌面通知+提示音）
│       ├── views/       # LoginView、RegisterView、ResetPasswordView、ChatView、ProfileView、AdminView
│       └── styles/      # tokens.css、base.css
├── server/              # 后端模块
│   ├── db.js            # SQLite 全部数据访问（node:sqlite，同步 API）
│   ├── routes.js        # HTTP API 路由（/api/*）
│   ├── socket.js        # Socket.IO 事件处理（消息、私聊、回应、撤回…）
│   ├── channels.js      # 频道 helpers（成员摘要、在线状态、权限）
│   ├── presence.js      # 在线状态注册表
│   ├── middleware.js    # 鉴权中间件（authenticateUser 等）
│   ├── user-session.js  # 单会话登录 token 校验
│   ├── dm-crypto.js     # 私聊密钥派生/加解密（服务器侧只管理密钥存储）
│   ├── validation.js    # 输入校验（validateUsername、validateMediaUrl 等）
│   ├── badwords.js/json # 敏感词过滤
│   ├── log.js           # 日志（敏感字段脱敏、保留天数清理）
│   └── data/            # 运行时 sqlite + 管理员凭据（不入库）
├── public/              # 静态资源；public/uploads/ 为用户上传（不入库）
├── tests/               # 后端测试（node --test tests/*.test.js）
├── scripts/             # reset-data.js（重置数据）
├── deploy/              # 部署脚本：windows/ linux/ docker/ + README 指南
├── images/              # README 截图
├── index.js             # 服务入口（HTTP/HTTPS、中间件、限流、启动）
├── Dockerfile           # 多阶段容器构建
├── AGENT.md             # 本文件
└── package.json
```

## 常用命令

```bash
npm start                       # 启动（自动读取根目录 .env：node --env-file-if-exists=.env index.js）
npm run dev                     # nodemon 热重启
npm test                        # 后端测试（node --test）
npm test --prefix client        # 前端测试（vitest run）
npm run build --prefix client   # 构建前端（client/dist）
npm run reset-data              # 清空数据并恢复本地默认管理员 admin/admin123
```

**任何改动完成前必须跑通两套测试**：`npm test` + `npm test --prefix client`，且前端 `npm run build` 成功。

## 架构与数据流

- **单一服务**：浏览器加载 `client/dist` 的静态页 → 页面用 `http.js` 调 `/api/*` 做认证/业务 → 用 `socket.js` 建立 Socket.IO 长连接做实时收发。
- **消息路径**：Socket.IO 事件 `sendMessage`（频道）/ `sendPrivateMessage`（私聊）→ `server/socket.js` 校验并入库 → 广播 `message:new`。
- **私聊加密在浏览器端完成**：`client/src/stores/e2ee.js` 负责生成/恢复密钥、加解密；服务器只存密文（`dm-crypto.js` 只做密钥的加密存储与取回）。群聊/频道不加密。
- **鉴权**：`user-session.js` 维护「当前会话」token；登录/私聊/上传等接口校验 JWT 且校验是否仍是当前会话（单会话登录，顶号冻结）。

## 安全模型（改动前必读）

- **端到端加密**：私聊用 WebCrypto ECDH P-256 + AES-256-GCM，密钥由登录密码经 PBKDF2 派生后加密存服务器。因此**必须 HTTPS**（`crypto.subtle` 只在安全上下文可用）；HTTP 下自动降级为明文（不报错，但不安全）。
- **可选 HTTPS**：`index.js` 检测 `SSL_CERT_FILE`/`SSL_KEY_FILE`（PEM 路径），同时设置则用 `https.createServer` 监听同一 `PORT`。局域网自签证书由 `deploy/windows/deploy.ps1` 生成。
- **防存储型 XSS（关键）**：所有入库的媒体 URL（图片/视频/语音/文件/表情包）必须过 `server/validation.js` 的 `validateMediaUrl`——只允许站内 `uploads/` 相对路径或 `http(s)://`，拒绝 `javascript:`/`data:` 等。新增「用户可控 → 前端 v-html / src」的路径时必须同样校验。B站卡片用 `BV[a-zA-Z0-9]+` 正则提取 + `encodeURIComponent`，只渲染官方 `player.bilibili.com` iframe；网易云音乐卡片/外链播放器同样用 `\d+` 正则提取 ID + `encodeURIComponent`，只渲染官方 `music.163.com` iframe。
- **其他**：JWT 会话、单会话登录、登录/注册/上传/后台登录按 IP 限流、CORS 来源校验（`isAllowedOrigin`）、上传白名单（MIME+扩展名：图片/语音 10MB、文件/视频 100MB）、日志默认不记正文且递归脱敏。
- **媒体过期清理**：上传的图片/视频/语音/文件 7 天自动删除（`index.js` 每 6 小时跑 `listExpiredMediaMessages`/`markMessageExpired`），消息保留并标记 `media_expired` 显示"已过期"。
- **依赖审计**：`npm audit` 应为 0 漏洞。`package.json` 的 `overrides` 段是关键锁版（engine.io 6.6.9、picomatch 2.3.2 等），升级依赖时务必同步检查，不要删掉。

## 部署方式

完整指南见 `deploy/README.md`。三种方式：

1. **Windows 局域网一键脚本（推荐）**：`deploy/windows/deploy.ps1` → 自动装依赖、构建、生成密钥/管理员密码、生成自签证书、HTTPS 启动。日常启动 `start-joychat.bat`。
2. **Linux + Caddy**：`deploy/linux/deploy.sh` → systemd 开机自启 + 有域名时 Caddy 自动申请 Let's Encrypt 正式证书。
3. **Docker + Caddy**：`deploy/docker/` → `docker compose up -d --build`，Caddy 自动 HTTPS。

反向代理（Linux/Docker）场景下，浏览器来源端口与后端不同，必须在 `.env` 里设 `JCHAT_ALLOWED_ORIGINS`（如 `https://chat.example.com`）放行来源，否则 CORS 会拦截。

## 开发约定（务必遵守）

- **Git 提交署名必须是用户本人**：`Jov3c <255788024+Jov3c@users.noreply.github.com>`。**绝不允许把 Claude/AI 加进 contributors 或提交署名**。可用 `git -c user.name=Jov3c -c user.email=... commit`。
- **提交信息风格**：中文，前缀如 `功能：`、`修复：`、`安全：`、`文档：`、`重构：`。
- **临时文件放 `_work/`**（已 gitignore），不要散落在仓库根目录。
- **测试先行（TDD）**：新增/修改功能先写测试再实现；改完跑全部测试。
- **视觉对齐**：若本工作区存在 `_work/jchat-preview.html`，视觉改动以其为准（该文件不入库，仅本地参考）。
- **沟通对象是非技术用户**（产品经理式）：需求不明确时不要猜，用选择题确认；解释用大白话，少术语。
- 不要引入 TypeScript、不要在运行时引入新框架；保持纯 JS、轻依赖。
- 数据库字段/表结构改动要同步 `server/db.js` 建表逻辑与相关测试；迁移策略请先和用户确认。

## 当前状态（2026-09-03）

- 里程碑 M1（前端重构）、M2（E2EE）、M3（协作功能）、M4（后端整理）**全部完成**。
- **v2.5.0 新增**：消息历史分页（最近 50 条 + 滚动加载更早）、桌面通知与提示音（资料页可开关）、恢复码与忘记密码（恢复码=第二把钥匙加密私钥副本存服务器，忘密码可重置且私聊历史不丢）。
- 加密要点：恢复码由 `client/src/stores/e2ee.js` 的 `generateRecoveryCode`（20 位去混淆字符集）生成；服务器只存 `recovery_key` 密文与 bcrypt 哈希（`users.recovery_key`/`recovery_code_hash`），不经手明文；重置密码会作废旧会话。相关接口：`PUT /api/profile/recovery`、`POST /api/recovery/verify`、`POST /api/reset-password`、`POST /api/profile/verify-password`。历史消息接口支持 `limit`/`before_id` 分页并返回 `has_more`。
- 质量：后端 65 测试 + 前端 67 测试全绿；CI 全绿；`npm audit` 0 漏洞。
- 最近工作：v2.5.0 消息分页、桌面通知、恢复码/忘记密码。
