# ♠️ Poker Night (德州扑克联机游戏)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/socket.io-v4.8.0-blue.svg?style=flat-square)](https://socket.io/)
[![Database](https://img.shields.io/badge/sqlite-better--sqlite3-orange.svg?style=flat-square)](https://github.com/WiseLibs/better-sqlite3)
[![Framework](https://img.shields.io/badge/express-v4.21.0-lightgrey.svg?style=flat-square)](https://expressjs.com/)
[![Protocol](https://img.shields.io/badge/HTTPS-Secure--Lock-success.svg?style=flat-square)](#)

> **Poker Night** 是一款轻量、优雅、低延迟的网页德州扑克联机游戏，专为朋友间在线联机娱乐打造。项目采用原生 Web 技术栈与极简设计，无需繁琐的客户端下载或繁重的编译打包，在浏览器中即可获得如原生 App 般丝滑的实时打牌体验。

---

## 🌟 核心特性 (V1 已完美达成)

*   **⚡ 实时扑克对战引擎**：支持 2-6 人同桌竞技。实现完整的德州扑克标准规则，包括盲注结构、下注轮次、全自动边池（Side Pots）计算、7选5最佳手牌牌力自动评估、摊牌比牌等。
*   **👤 完善的账号与持久筹码**：内置基于 `bcrypt` 加密与 `cookie-session` 安全认证的账号系统。玩家数据及筹码余额（Chips）安全地持久化记录于 SQLite 中，不怕断网或服务器重启。
*   **📡 离线托管与断线重连**：当玩家在局中意外掉线时，系统会自动发出全局警示通知，并开启**自动折牌（Fold）托管机制**以维持游戏流畅进行；玩家重新联网后，可一键无缝重连回桌，筹码与手牌状态秒级恢复。
*   **👑 独立明牌管理后台**：内置只读/只管理员可见的实时明牌监控面板，支持筹码一键注入（Buyin）、全局消息广播通知，方便牌局组织者轻松把控全场。
*   **🎵 沉浸式高保真音效与 BGM Fallback**：支持行动飘字高亮、倒计时滴答、筹码撞击、卡牌飞掠等精美声效；若外部高品质爵士乐 BGM 链接不可用，会自动触发内置的 **Web Audio API 降级算法**，在本地实时由代码合成 Lo-Fi 爵士背景音乐。
*   **🔒 生产级 HTTPS & WSS 升级**：支持专业的二级域名绑定，已通过 Nginx 反代及 Certbot SSL 证书全自动配置 `80 -> 443` 的 HTTPS 强转，支持安全的 WebSocket（`wss://`）长连接，阻断纯 IP 裸连的安全隐患。

---

## 🛠️ 技术栈与架构设计

为了保证极致的加载速度与最低的运行时开销，项目特意摒弃了任何前端构建工具（如 Webpack/Vite）及重量级框架（如 React/Vue），回归高雅的原生技术本质：

*   **前端 (public/)**：
    *   **结构**：原生 HTML5 语义化标签 + 极简单页应用架构（#view-auth / #view-game / #view-history 视图动态无缝切换）。
    *   **样式**：原生 CSS3，利用 CSS 变量（CSS Variables）统领全局 UI 设计系统，构建极简现代感暗黑霓虹风界面。
    *   **逻辑**：Vanilla ES6 Javascript，采用响应式数据流方案更新 UI。
*   **后端 (server/)**：
    *   **服务**：Node.js + Express Web 框架。
    *   **通信**：基于 `Socket.IO` 进行高频、极速的双向实时状态广播。
*   **存储与运维**：
    *   **数据库**：SQLite 3（使用高性能 C++ 驱动 `better-sqlite3`），并开启高速 WAL 模式。
    *   **进程守护**：PM2 进程管理，为应用提供秒级零中断热重载（零丢失玩家长连接）。
    *   **反向代理**：Nginx，开启 Gzip 静态资源最高比例压缩分发，并完成 WebSocket 协议升级调优。

---

## 🚀 本地开发与快速启动

### 1. 克隆仓库
```bash
git clone https://github.com/jchensh/texas-holdem.git
cd texas-holdem
```

### 2. 安装依赖
项目要求 Node.js 版本 `>=20.0.0`：
```bash
npm install
```

### 3. 配置环境变量
复制模板生成本地开发配置文件（本地开发环境参数均可使用默认值缺省）：
```bash
cp .env.example .env
```

### 4. 启动开发服务器
```bash
npm run dev
```
启动后，在浏览器访问 [http://localhost:3000](http://localhost:3000) 即可开始本地调试。

### 5. 运行自动化测试套件
项目配备了完整的扑克引擎数学规则单元测试以及断线重连端到端（E2E）集成测试：
```bash
npm test
```

---

## 🌐 生产部署与自动化运维

项目为生产环境准备了完善的一键式自动化运维生态，详细的搭建步骤与高频故障字典请移步阅读 [DEPLOY.md](DEPLOY.md)。

### 极速部署流程示意：
```bash
# 1. 登录服务器拉取代码
cd /var/www/poker-night
git clone -b main https://github.com/jchensh/texas-holdem.git .

# 2. 运行一键全自动部署脚本（精简生产依赖、授权、PM2 启动）
chmod +x scripts/deploy.sh
./scripts/deploy.sh

# 3. Nginx 域名绑定与 Certbot SSL 全自动证书配置
sudo ln -sf /var/www/poker-night/poker-night.nginx.conf /etc/nginx/sites-enabled/poker-night
sudo certbot --nginx -d poker.yourdomain.com
```

---

## 🗺️ 未来展望 (Roadmap)

我们已经在 [FutureRoadmap.md](FutureRoadmap.md) 中完整沉淀了该项目的未来演进构想：
*   **V1.5 (近期)**：前端原生 JS 重构与代码治理，规范事件系统。
*   **V2.0 (中期)**：引入 React + TypeScript 进行客户端架构重写，强化战绩 Timeline 复盘表现。
*   **V2.5+ (远期)**：引入 PixiJS 高性能 2D 渲染引擎接管牌桌表现，实现高拟真发牌、筹码滑行与华丽结算动效。

---

## 📄 开源协议

本项目目前以公开仓库形式维护，便于生产服务器直接从 GitHub 拉取部署。请勿提交 `.env`、真实 `SESSION_SECRET`、线上 SQLite 数据库、云端 Nginx/PM2 实际配置等敏感内容。
