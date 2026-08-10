# Jchat-JoyChat

一个轻量、完整的实时聊天应用。Jchat 使用 Node.js、Socket.IO 与 SQLite 构建，包含公共频道、受邀可见的私有频道、好友私聊、在线状态、表情包和统一的后台管理页面。

> 当前版本：`2.2.0` · 推荐 Node.js `22.5.0` 或更高版本

## 页面预览

### 聊天界面

![Jchat 聊天界面](docs/images/jchat-chat.png)

<details>
<summary>查看更多页面</summary>

### 登录界面

![Jchat 登录界面](docs/images/jchat-login.png)

### 管理后台

![Jchat 管理后台](docs/images/jchat-admin.png)

</details>

## 主要功能

- 实时频道聊天：内置“公共频道1”和“公共频道2”，消息通过 Socket.IO 实时同步。
- 私有频道：创建者默认拥有频道，只有受邀成员可以看到和进入。
- 好友与私聊：支持按用户名添加好友、好友申请以及一对一会话。
- 富媒体消息：支持图片、语音、Bilibili 视频链接和自定义表情包。
- 表情包管理：可以添加自己的表情包，并收藏其他用户发送的表情。
- 消息操作：支持回复、撤回、搜索当前会话以及全局搜索。
- 在线状态：支持在线、忙碌、离开和隐身；隐身用户不会计入频道在线人数。
- 单会话登录：同一账号仅允许一个有效页面会话，新的登录会替换旧会话。
- 管理后台：提供用户、密码、日志、注销申请与站点设置管理。
- 本地持久化：用户、频道、消息和关系数据保存在 SQLite 中。
- 响应式界面：桌面端与移动端采用统一的暖色玻璃卡片视觉系统。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web 服务 | Node.js、Express |
| 实时通信 | Socket.IO |
| 数据库 | Node.js 内置 `node:sqlite` |
| 身份认证 | JWT、bcrypt |
| 文件处理 | Multer、Sharp |
| 前端 | 原生 HTML、CSS、JavaScript |
| 测试 | Node.js Test Runner |

## 快速开始

### 1. 环境要求

- Node.js `>= 22.5.0`
- npm `>= 10`
- Windows、macOS 或 Linux

### 2. 获取并安装

```bash
git clone https://github.com/Jov3c/Jchat.git
cd Jchat
npm install
```

### 3. 启动完整应用

```bash
npm run start-all
```

启动后访问：

- 聊天页面：<http://localhost:3001>
- 管理后台：<http://localhost:3001/admin>
- API 与 Socket.IO：<http://localhost:3000>

前端服务会把 `/api` 请求代理到 `3000` 端口，因此浏览器始终通过 `3001` 端口访问页面，无需切换端口。

## 环境变量

仓库中的 `.env.example` 列出了可用配置。Jchat 读取进程环境变量；部署时请在运行环境、服务管理器或容器中设置这些值。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | API 与 Socket.IO 端口 |
| `FRONTEND_PORT` | `3001` | 页面服务端口 |
| `JWT_SECRET` | 开发占位值 | JWT 签名密钥，生产环境必须修改 |
| `JWT_EXPIRES_IN` | `30d` | 登录令牌有效期 |
| `DM_ENCRYPTION_KEY` | 空 | 私聊落库加密密钥，生产环境必须设置 |
| `ADMIN_USERNAME` | `admin` | 默认管理员用户名 |
| `ADMIN_PASSWORD` | `admin123` | 默认管理员密码，生产环境必须修改 |
| `JCHAT_DB_FILE` | `server/data/jchat.sqlite` | 自定义 SQLite 数据库路径 |

生成私聊加密密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 常用命令

```bash
npm run start-all    # 同时启动 API 和前端服务
npm start            # 仅启动 API 与 Socket.IO
npm run frontend     # 仅启动前端服务
npm run dev          # 监听并重启 API 服务
npm run dev-frontend # 监听并重启前端服务
npm test             # 运行自动化测试
npm run reset-data   # 清空运行数据并恢复默认管理员
```

`reset-data` 会删除用户、频道、消息、好友关系和上传内容。执行前请先备份需要保留的数据。

## 默认账号

开发环境首次启动或重置数据后，可使用以下管理员账号：

```text
用户名：admin
密码：admin123
```

公开部署前请务必修改管理员密码、JWT 密钥和私聊加密密钥。

## 项目结构

```text
Jchat/
├─ public/              # 页面、样式、浏览器脚本与静态媒体
│  ├─ css/
│  ├─ images/
│  ├─ js/
│  ├─ uploads/         # 用户上传目录，内容不提交到 Git
│  └─ videos/
├─ server/              # SQLite、会话、状态、日志与校验模块
│  └─ data/            # 运行时数据库目录，内容不提交到 Git
├─ scripts/             # 前端服务与数据重置脚本
├─ tests/               # 自动化测试
├─ docs/images/         # README 页面预览图
├─ index.js             # API 与 Socket.IO 入口
└─ package.json
```

## 数据与备份

- SQLite 数据库默认位置：`server/data/jchat.sqlite`
- 用户上传默认位置：`public/uploads/`
- 两个目录中的运行时内容已加入 `.gitignore`，不会被提交到仓库。
- 登录页背景视频为压缩后的 720p / 30fps 文件，以控制仓库体积。

备份时建议同时保存数据库文件和 `public/uploads/` 目录。

## 测试

```bash
npm test
```

测试覆盖数据库、输入校验、会话互斥、在线状态、频道访问与主要页面契约。

## 安全说明

- 不要在公开仓库中提交 `.env`、SQLite 数据库、日志或上传文件。
- 生产环境必须替换默认管理员密码与 `JWT_SECRET`。
- 请为 `DM_ENCRYPTION_KEY` 设置独立的高强度随机值，并妥善备份；更换密钥可能导致已有私聊内容无法解密。
- 如需暴露到公网，建议在 Jchat 前方配置 HTTPS 反向代理并限制允许的来源。

## License

MIT
