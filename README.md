# Roleplay Hub Plus

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D.svg?logo=vue.js)](https://vuejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)

> **一款支持自部署的 AI 角色扮演（Roleplay）对话和角色卡生成工具。**

**基于 [STA1N156/RP-Hub](https://github.com/STA1N156/RP-Hub) 修改。**

## 该Fork项目仅针对个人需求打造，不具有普适性！谨慎使用

### 相比原项目的修改内容

- 新增 Node.js 后端，数据存储在服务器端 SQLite 数据库
- 新增安全登录系统（密码 + Passkey/WebAuthn 支持）
- 防暴力破解（速率限制 + 递进式账户锁定）
- 新增深色主题（Pure Black / OLED 纯黑风格）
- 新增外观设置面板，支持 浅色 / 深色 / 跟随系统 三种模式切换
- 主题偏好持久化存储，跟随系统模式实时响应系统主题变化
- 切换时带平滑过渡动画
- 上下文压缩

**【免责与授权声明】**
本项目基于 **[CC BY-NC 4.0（知识共享-署名-非商业性使用 4.0 国际许可协议）](./LICENSE)** 开源。原始项目由 [STA1N156](https://github.com/STA1N156) 创建。**明确禁止任何形式的商业化使用。** 任何使用者必须遵守该协议，尊重原作者的署名权。

---

## 部署方式 (Deployment)

### 环境要求

- Node.js 20+ (推荐 22 LTS)
- 一台服务器（推荐 Linux）
- 域名 + Caddy（自动 HTTPS）

### 1. 克隆项目

```bash
git clone https://github.com/StingGrey/RP-Hub.git
cd RP-Hub/server
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，生成随机密钥：

```bash
# 生成 SESSION_SECRET (64 字符)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 生成 ENCRYPTION_KEY (32 字节 = 64 hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```env
PORT=3000
SESSION_SECRET=<粘贴生成的值>
ENCRYPTION_KEY=<粘贴生成的值>
RP_ORIGIN=https://yourdomain.com
NODE_ENV=production
```

### 3. 创建用户

```bash
node setup.js
```

### 4. 启动服务

```bash
# 直接运行
node server.js

# 或使用 PM2（推荐）
npm install -g pm2
pm2 start server.js --name rphub
pm2 save && pm2 startup
```

### 5. 配置 Caddy 反向代理

`/etc/caddy/Caddyfile`:
```
yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

---

## 目录结构

```text
RP-Hub/
├── index.html                # 前端主页面
├── character/index.html      # 角色卡生成器
├── assets/
│   ├── css/styles.css        # 样式（含深色主题）
│   └── js/
│       ├── app.js            # 前端核心逻辑
│       └── utils.js          # 工具函数
├── server/                   # 后端
│   ├── server.js             # Express 入口
│   ├── db.js                 # SQLite 初始化
│   ├── setup.js              # 用户创建 CLI
│   ├── middleware.js          # 认证中间件
│   ├── routes/
│   │   ├── auth.js           # 登录/登出
│   │   ├── data.js           # 数据 CRUD
│   │   └── passkey.js        # Passkey/WebAuthn
│   ├── package.json
│   └── .env.example
└── README.md
```

---

## 安全特性

| 特性 | 说明 |
|------|------|
| 密码哈希 | Argon2id（抗 GPU/ASIC 攻击） |
| Passkey | WebAuthn/FIDO2 无密码登录 |
| 速率限制 | 登录接口 10 次/15 分钟/IP |
| 账户锁定 | 5 次失败锁 15 分钟，10 次锁 1 小时，20 次锁 24 小时 |
| Session | HTTP-only, Secure, SameSite=Strict, 7 天有效 |
| 安全头 | Helmet (CSP, HSTS, X-Frame-Options 等) |

---

## 协议与许可 (License)

**[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans)** — 署名-非商业性使用

详细许可条款请参见 [`LICENSE`](./LICENSE) 文件。
