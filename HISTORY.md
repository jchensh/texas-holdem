# 开发日志（HISTORY）

本文件记录每一步的范围、产出、关键决策。
**新会话恢复时先读本文件 + `CLAUDE.md` 就能拿到完整上下文。**

格式约定：每个 step 一节，标注日期、commit、产出文件、决策记录。

---

## Step 1 — 项目骨架（2026-05-18，commit `61fc49a`）

**目标**：搭起前端三视图静态骨架 + 项目依赖清单，先有"形"再填"魂"。

**产出**：
- `package.json` — Node 20+，依赖 `express` / `socket.io` / `better-sqlite3` / `bcrypt` / `cookie-session`；脚本 `start` / `dev`（用 `node --watch`）/ `test`（用 `node --test`）
- `public/index.html` — 三视图：
  - `#view-auth`：登录/注册 tab
  - `#view-game`：椭圆牌桌 + 5 对手席（`#seat-1`~`#seat-5`）+ 英雄区（`#seat-0`）+ 操作面板（弃/过/跟/加注+滑杆）+ 大厅蒙层
  - `#view-history`：手牌列表 + 汇总
- `public/style.css` — 全部样式集中，CSS 变量 `:root`，无预处理器
- `public/js/app.js` — `App` 单例，公开接口已经定型（updateGameState / startNewHand / dealCommunityCards / onPlayerAction / showActionPanel / hideActionPanel / showHandResult / onPlayerJoined / updateChips 等），当前用占位数据驱动
- `public/js/socket.js` — `SocketClient` 全部用注释占位，明确列出了 emit/on 的事件协议（见文件头注释）

**关键决策**：
- 前端**不引入构建工具/框架**，三个 `<script>` + 一个 `<link>` 直接跑。
- 视图切换靠 `.view` 加/去 `.active`，CSS 控制 `display:none/flex`。
- 牌桌用 `position:absolute` 在 900×530 的 `.table-scene` 内绝对定位 5 个对手席，英雄席固定底部中央。
- 牌面渲染由 `App._cardInnerHTML({rank, suit})` 统一生成；红色花色加 `.red` class。

---

## Step 2 — 认证与数据库（2026-05-18，commit `cba9ab4`）

**目标**：后端起架子，把登录注册和持久层先打通；不接 Socket.IO、不实现游戏逻辑。

**产出**：
- `server/config.js` — 集中读取环境变量（`PORT` / `NODE_ENV` / `SESSION_SECRET` / `SESSION_MAX_AGE_MS` / `DB_PATH` / `STARTING_CHIPS` / `SMALL_BLIND` / `BIG_BLIND` / `ACTION_TIMEOUT_MS`）。开发默认值后置，环境变量优先。
- `server/db.js` — better-sqlite3 初始化：
  - 自动创建 `data/` 目录
  - `journal_mode = WAL`、`foreign_keys = ON`
  - 两张表：
    - `users(id, username UNIQUE, password_hash, chips DEFAULT 1000, lifetime_profit DEFAULT 0, created_at)`
    - `hand_history(id, user_id FK, hand_id, ended_at, result, profit, chips_after, hole_cards JSON, community_cards JSON, action_summary)` + 索引 `(user_id, ended_at DESC)`
  - schema 用 `IF NOT EXISTS` 自然幂等，**不引迁移系统**
- `server/auth.js` — 四个 REST 接口：
  - `POST /api/register` — 用户名 3-16 位（字母/数字/下划线/中文），密码 ≥6 位，bcrypt rounds=10；注册后自动写 session
  - `POST /api/login` — 用户不存在时也跑一次 `bcrypt.compare` **防止响应时间侧信道枚举用户名**
  - `POST /api/logout` — 清 session
  - `GET /api/me` — 用于刷新页面恢复登录态
  - 导出 `requireAuth(req, res, next)` 中间件，给后续 socket 握手共用
- `server/index.js` — Express + `cookie-session`（HMAC 签名 cookie，非服务端存储），生产环境 `trust proxy=1` 给 Railway 用；静态文件挂在 `/api` 路由之后；**Socket.IO 还没挂**
- `.env.example` — `PORT` / `NODE_ENV` / `SESSION_SECRET`（含生成命令）/ `DB_PATH`

**关键决策**：
- Session 用 cookie-session（无服务端存储），`SESSION_SECRET` 泄漏 = 任意伪造登录态，部署时**必须**改。
- 单库直连，`better-sqlite3` 同步 API，没事务包裹的查询直接 `prepare` + `run/get`。
- 用户名正则容许中文。
- `lifetime_profit` 字段先建好，step 6+ 结算时再写。

---

## Step 3 — 前端接入认证 API（2026-05-19，待提交）

**目标**：前端 4 个 TODO 切到真实 API，认证链路端到端跑通。

**产出**（仅改 `public/js/app.js`）：
- 新增 `App._apiPost(path, body)` / `App._apiGet(path)` 两个最小 fetch 辅助：
  - `credentials: 'same-origin'`（cookie-session 自动随同源请求带上）
  - 失败抛 `Error(data.message)`，调用方直接显示给用户
- `App.init` 改为 async，启动时调 `GET /api/me`：
  - 200 → `_onLoginSuccess(user)` 直接进 game 视图（**带真实 chips**，不再硬编码 1000）
  - 401/其它 → 停留 auth 视图
- `form-login` / `form-register` submit 切真实 `POST /api/login` / `POST /api/register`
- `btn-logout` 改为 async，先 `POST /api/logout` 再清前端状态并切回 auth；同时清空密码框和错误文案，防止残留
- `_onLoginSuccess` 进入大厅前重置 `#lobby-players` 和 `#lobby-count`，避免登出再登入残留旧条目

**关键决策**：
- 客户端**保留**注册前的简单预校验（用户名长度 / 密码长度 / 两次密码一致），后端会再校一次。理由：即时反馈，体验更好；正则交由后端，不重复维护。
- logout 的 fetch 失败也照样切回 auth 视图——前端状态先于网络成功更新，避免卡死。
- 没引入任何依赖，没改 HTML 结构。

**冒烟测试**（`node server/index.js` 起服务 + curl，已验证 8 个用例全通过）：

| # | 用例 | 期望 | 实际 |
|---|------|------|------|
| 1 | `GET /api/me` 无 cookie | 401 | ✅ 401 `未登录` |
| 2 | `POST /api/register` 新账号 | 200 + Set-Cookie | ✅ 200，user 含 id/username/chips=1000 |
| 3 | `GET /api/me` 带 cookie | 200 | ✅ 200，返回同一 user |
| 4 | `POST /api/logout` | 200 | ✅ 200 `{ok:true}` |
| 5 | `GET /api/me` 登出后 | 401 | ✅ 401 |
| 6 | `POST /api/login` 同账号 | 200 | ✅ 200 |
| 7 | `POST /api/register` 重名 | 409 | ✅ 409 `用户名已被占用` |
| 8 | `POST /api/login` 错密码 | 401 | ✅ 401 `用户名或密码错误` |

注：测试时本机 `HTTP_PROXY` 环境变量会拦截 localhost，需 `NO_PROXY=localhost,127.0.0.1` 才能直连。生产无此问题。

**遗留 / 给 step 4 的提示**：
- `SocketClient.connect(null)` 的占位 token 不再需要——cookie-session 同源 fetch 时浏览器会自动带上 cookie，Socket.IO 握手用 polling/websocket 升级时同样会带。step 4 服务端在 io middleware 里复用 `cookie-session` 即可拿到 `req.session.userId`。
- 大厅列表（`#lobby-players` / `#lobby-count`）目前还是本地添加，step 4 接入 socket 后改成服务器广播。

---

## 整体框架

```
浏览器                                  服务器
─────────                               ─────────
index.html
  ├─ app.js          ──HTTP/fetch──►    /api/*          (Express + auth.js)
  │   ├─ App 状态机                                          │
  │   └─ 渲染层                                              ▼
  └─ socket.js       ──WS(待挂)───►     Socket.IO       (step 4)
                                             │
                                             ▼
                                        游戏引擎 / 房间   (step 5-6)
                                             │
                                             ▼
                                        better-sqlite3
                                        users + hand_history
```

数据流：后端推 `game_state` → `SocketClient` 监听 → 调 `App.updateGameState(state)` → DOM。

---

## V1 Roadmap

| step | 目标 | 状态 |
|------|------|------|
| 1 | 前端三视图骨架 + 依赖清单 | ✅ commit `61fc49a` |
| 2 | 后端认证 + SQLite schema | ✅ commit `cba9ab4` |
| 3 | 前端接入认证 API | ✅ 2026-05-19（待提交） |
| 4 | Socket.IO 握手 + 大厅（落座 / 离座 / 玩家列表广播） | ⏳ |
| 5 | 扑克引擎（牌堆 / 发牌 / 下注轮 / 边池 / 7选5 牌力 / 摊牌） | ⏳ |
| 6 | 引擎接入房间，广播 `game_state` / `your_turn` / `hand_result`，落库 `hand_history`、更新 `chips` | ⏳ |
| 7 | `GET /api/history` + 前端 `_loadHistory` 接真实数据 | ⏳ |
| 8 | Railway 部署（持久卷、健康检查、`SESSION_SECRET`） | ⏳ |

---

## 给下一次会话的提示

1. 先读本文件 → 知道做到哪步
2. 再读 `CLAUDE.md` → 知道项目规范和前端结构约定
3. `git log --oneline` 看最新进度
4. 如果"上一步在做什么"和 HISTORY.md 不一致，**以代码和 git log 为准**，并更新本文件
