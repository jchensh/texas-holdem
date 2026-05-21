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

## Step 3 — 前端接入认证 API（2026-05-19，commit `424119f`）

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

## Step 5 — 扑克引擎（2026-05-20，待提交）

**目标**：纯逻辑的德州扑克引擎，覆盖牌堆 / 7选5 牌力 / 边池 / 一手牌生命周期，全部可独立单测，不依赖 socket 或 db。

**产出**（全部在 `server/engine/`）：
- `deck.js` — 52 张牌结构 + Fisher–Yates 洗牌（rng 可注入便于测试）+ `deal(deck, n)` 从顶 pop
- `hand-rank.js` — 7选5 评估器：
  - `evaluate5(cards)` 给 5 张返回 `{category, tiebreakers, cards}`
  - `evaluate7(cards)` 枚举 C(7,5)=21 个组合取最优
  - `compareScore(a, b)` 字典序比较 score 数组
  - 9 个 category：同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌；wheel A-2-3-4-5 按 5 算
- `pot.js` — 边池切分：
  - `computePots(contributors)` 按 all-in 层级切；弃牌玩家的钱进 pot 但他无资格
  - `distribute(pots, pickWinners)` 按赢家分；平分有余数时从前依序加 1
- `game.js` — 一手牌的状态机 `Game` 类：
  - 构造时发手牌、贴盲、定首动者（heads-up = SB 先；3+ = UTG = BB 下家先）
  - `act(seatId, {type, amount?})` 处理 fold/check/call/raise，返回 `continue | round_end | hand_end`
  - 加注重新打开他人行动；只剩 1 人未弃牌 → 立即结束；≤1 个 active 但还有 all-in → 直接发完公共牌摊牌
  - `getPublicState(viewerSeatId)` 给前端的快照：viewer 看到自己的 holeCards，其他遮蔽；手牌结束后所有人可见
- `index.js` — barrel 导出
- 配套 `*.test.js` 共 **48 个用例全过**

**关键决策**：
- **测试用例可控**：`Game` 构造接受可注入的 `deck` 参数；测试里用 `deckOf('As','Ks',...)` 帮手把牌放到 pop 顺序对的位置
- **V1 简化**：all-in 小于 minRaise 仍重新打开行动（标准规则不重新打开，留到 V2）；无 burn card（不烧底牌）
- **状态字段三层**：`chips`（手头）/ `currentBet`（本街投入）/ `totalBet`（本手累计），分别服务"还能 raise 多少 / 还差多少跟 / 切边池"
- **floor 余数派发**：平分有余数时从第一个赢家开始派 +1，避免 `Math.floor` 后凭空消失
- **包测试脚本**修正：`npm test` 原本是 `node --test server/`，但 Node 把目录路径当成单个测试文件，应改成 `node --test`（自动发现 `**/*.test.js`）

**冒烟测试**（`npm test`，48 个全过）：

| 模块 | 测试数 | 覆盖 |
|------|--------|------|
| deck | 7 | 构造 / 洗牌确定性 / 发牌 |
| hand-rank | 19 | 全 9 种 category + wheel + 7 选 5 + 比较 |
| pot | 8 | 主池 / 多层边池 / 弃牌资格 / 平分余数 |
| game | 14 | 盲注、首动、行动校验、弃牌胜出、heads-up/3 人摊牌、all-in 边池、平局 |

**遗留 / 给 step 6 的提示**：
- `Game` 是单手牌实例；房间生命周期（多手轮换、dealer button 移位、坐站、断线重连）由 step 6 处理
- `getPublicState` 直接序列化下发即可；前端 `App.updateGameState` 已经按这个 schema 写
- `actionLog` 已包含每一步行动，step 7 写 `hand_history.action_summary` 字段时直接 stringify
- `results.summary[i]` 提供 `{ result, profit, chipsAfter, categoryName }`，恰好对应 `hand_history` 的列
- 若 minRaise / all-in raise 想升级成标准规则，集中在 `act()` 的 raise 分支

---

## Step 4 — Socket.IO 握手 + 大厅广播（2026-05-20，待提交）

**目标**：把实时通道铺好，登录后浏览器和服务器通过 Socket.IO 双向连接；大厅玩家列表从本地"假数据"切到服务端广播。

**产出**：
- `server/index.js` — 拆出 `http.createServer(app)` 包一层，挂 `socket.io`；把 `cookieSession(...)` 抽成 `sessionMiddleware` 实例，Express 和 `io.engine.use()` 共用同一份，握手请求即可读到 `req.session.userId`
- `server/lobby.js`（新）— 大厅状态机：
  - 在 `io.use()` 里做握手鉴权：拿 `socket.request.session.userId` 查库，没有就 `next(new Error('未登录'))`
  - 连接/断开都 `io.emit('lobby_state', buildLobbyState())`，全员广播
  - `buildLobbyState()` 按 `userId` 去重——同一用户开多 tab 只算一人
- `public/index.html` — 加 `<script src="/socket.io/socket.io.js"></script>`（Socket.IO 自带的 client，无需 npm 安装）
- `public/js/socket.js` — 实装：
  - `connect()` 不再要 token；`io({ withCredentials: true })`，cookie 自动同源带上
  - `_bindEvents()` 把所有占位注释展开成真实 `socket.on(...)`，`lobby_state → App.updateLobby`
  - `emit.*` 全部接 `socket.emit`
- `public/js/app.js` — `_onLoginSuccess` 不再本地塞自己进大厅列表，改为先清空 + 显示蒙层，等服务端 `lobby_state` 广播过来重建；新增 `updateLobby(data)` 整列表重建
- `scripts/smoke-step4.js`（新）— Socket.IO 端到端冒烟脚本
- `package.json` — `socket.io-client` 加为 devDependency（只给冒烟脚本用，生产不打包）

**关键决策**：
- **session 共享**用 `io.engine.use(sessionMiddleware)` 而不是手撕 cookie 解析。代价：cookie-session 的内部表达和 Express 完全一致，零分歧。
- **去重维度**用 `userId`（不是 `socket.id`），多端登录 / tab 切换不会让自己出现两次。
- 鉴权失败用 `next(new Error('未登录'))`，客户端 `connect_error` 拿到的就是这条人话信息。
- 没有持久化在线状态——服务器重启意味着所有人需要重新连接。V1 单进程，可接受。
- 没做"是否落座"概念——大厅只显示"谁在线"。step 5 引擎接入后再引入 `seatId` / `ready`。

**冒烟测试**（`PORT=3010 node server/index.js` + `PORT=3010 node scripts/smoke-step4.js`，5 个用例全过）：

| # | 用例 | 期望 | 实际 |
|---|------|------|------|
| 1 | 未登录 socket 握手 | `connect_error` | ✅ `未登录` |
| 2 | A 登录后连接 | 收到 `count=1`，列表含自己 | ✅ |
| 3 | B 加入 | A 和 B 都收到 `count=2` | ✅ |
| 4 | A 开第二条 socket | `count` 仍为 2（按 userId 去重） | ✅ |
| 5 | A 全部断开 | B 收到 `count=1`，只剩 B | ✅ |

**遗留 / 给 step 5 的提示**：
- `lobby_state` 现在只有 `{ username, chips }`。step 5 起需要扩成"已就绪 / 座位号"，建议新事件 `seat_state` 区分。
- 大厅蒙层目前显示的还是泛泛的"等待玩家"，可以等 step 5 落座后改成"已就绪 N / 6"。
- `socket.io` server 没启 CORS——同源部署没事，万一前后端分离要加 `cors` 配置。
- `requireAuth` 中间件目前只给 Express 用，没有给 socket 复用；lobby.js 里的鉴权逻辑和它有少量重复（都是查 `findById`）。后续如果要加 socket 路由更多，考虑抽公共。

---

## Step 3.1 — 大厅蒙层可关闭（2026-05-19，commit `e7dc2d0`）

**目标**：登录后大厅蒙层锁死整个 game 视图、看不到牌桌，体验不好。让它可关闭。

**产出**：
- `public/index.html` — `lobby-card` 增加 × 关闭按钮和"先看看牌桌"按钮；新增 `#lobby-waiting-badge`（左下角角标）
- `public/js/app.js` — 关闭蒙层后在 `#view-game` 左下角显示金色脉冲点 + "等待其他玩家 N / 6"，点击角标可重新打开蒙层；`updateGameState`（真正开局）时蒙层和角标一起隐藏
- `public/style.css` — 角标样式 + 脉冲动画

**关键决策**：
- 蒙层不再是阻塞式 UI，只是默认显示；玩家可以提前看牌桌布局。
- 角标作为"蒙层已隐藏"的可视提示 + 重新打开入口，避免用户找不到大厅。

---

## Step 6 — 引擎接入在线房间与持久化结算（2026-05-22，commit `021200d`）

**目标**：将 Texas Hold'em 游戏引擎集成到 Socket.IO 房间中，实现客户端相对座位转换、倒计时动作管理、结算广播以及 SQLite 数据库持久化存储。

**产出**：
- `server/db.js` — 增加 `saveHandResults` SQLite 数据库原子事务函数，在单次写入中批量更新玩家的 chips、累加 lifetime_profit，并在 hand_history 表中插入手牌详情。
- `server/table.js` (新) — 核心房间/牌桌状态机单例：
  - 管理 6 个物理座位以及 Map 形式的 Spectators (旁观者)。
  - 实现新连接自动坐下 `sitPlayer` (限制在线人数上限最多 10 人) 与彻底离线清理物理座位托管机制。
  - 实现座位旋转翻译 `translateToRelative`，将绝对座位转换成以 Viewer 为 0 席位的相对座位数据推送。
  - 维护 30 秒超时自动 Check/Fold 的动作托管定时器。
  - 结算时执行结算更新、筹码自动充值，并延时 6 秒自动开启下一手牌。
- `server/lobby.js` — 彻底对接 Table 单例，简化大厅网关，将连接、动作、断开事件全权托管。
- `scripts/test-step6-e2e.js` (新) — Step 6 端到端自动化集成测试脚本，模拟并发注册、登录、落座、下注交互、摊牌结算和数据库断言。

**关键决策**：
- **人数限制**：在线玩家最多为 10 人。前 6 人入座，多余的 4 人作为旁观者。手牌结束时若有入座玩家离线，旁观者自动递补入座。
- **物理席位去重**：使用唯一 `userId` 标记物理席位，同一用户多 Tab / 断开重连会自动合并至同一个绝对座位号，避免重复分配。
- **结算事务安全**：为防结算写盘中途宕机造成数据不一致，全部筹码更新和手牌历史写入使用 `db.transaction` 包裹为原子操作。

**测试验证**：
- 运行 `npm test` 确认底层扑克引擎的 48 个单元测试全部通过。
- 运行 `node scripts/test-step6-e2e.js` 模拟 Alice, Bob, Charlie 的 3 人游戏流、结算广播及数据库写入，全部断言 100% 通过。

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
| 3 | 前端接入认证 API | ✅ commit `424119f`（+ UI 微调 `e7dc2d0`） |
| 4 | Socket.IO 握手 + 大厅（玩家列表广播） | ✅ commit `6a3dbfe` |
| 5 | 扑克引擎（牌堆 / 发牌 / 下注轮 / 边池 / 7选5 牌力 / 摊牌） | ✅ commit `2f27c7a` |
| 6 | 引擎接入房间，广播 `game_state` / `your_turn` / `hand_result`，落库 `hand_history`、更新 `chips` | ✅ commit `021200d` |
| 7 | `GET /api/history` + 前端 `_loadHistory` 接真实数据 | ⏳ |
| 8 | Railway 部署（持久卷、健康检查、`SESSION_SECRET`） | ⏳ |

---

## 给下一次会话的提示

1. 先读本文件 → 知道做到哪步
2. 再读 `CLAUDE.md` → 知道项目规范和前端结构约定
3. `git log --oneline` 看最新进度
4. 如果"上一步在做什么"和 HISTORY.md 不一致，**以代码和 git log 为准**，并更新本文件

