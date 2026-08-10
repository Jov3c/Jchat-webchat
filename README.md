# Jchat

Jchat 是一款轻量的实时聊天应用，提供公共频道、私有频道、私聊、好友、表情包和后台管理功能。界面采用现代化玻璃拟态风格，并支持在线状态与单账号单会话。

## 技术栈

- Node.js 22.5+
- Express + Socket.IO
- Node 内置 SQLite（`node:sqlite`）
- 原生 HTML、CSS、JavaScript

## 本地运行

```bash
npm install
npm run start-all
```

打开 [http://localhost:3001](http://localhost:3001)。前端服务运行在 `3001` 端口，API 与 Socket.IO 服务运行在 `3000` 端口。

常用命令：

```bash
npm test             # 运行测试
npm run reset-data   # 清空运行数据并恢复默认管理员
npm run launch       # 使用启动器运行
```

## 默认管理员

首次启动时会按环境变量创建管理员；未配置时使用：

- 用户名：`admin`
- 密码：`admin123`

请在生产环境中通过 `.env` 修改 `JWT_SECRET`、`DM_ENCRYPTION_KEY`、`ADMIN_USERNAME` 和 `ADMIN_PASSWORD`。可复制 `.env.example` 作为起点。

## 路由

- `/`：聊天主页
- `/login`：登录
- `/register`：注册
- `/admin`：后台管理

## 数据与媒体

SQLite 数据库默认位于 `server/data/jchat.sqlite`，上传内容位于 `public/uploads/`。这些运行时数据已被 Git 忽略，不会随源码提交。

背景视频已处理为 720p / 30fps，以减小仓库体积。

## 许可

MIT
