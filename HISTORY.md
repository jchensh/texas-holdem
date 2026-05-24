# 开发日志（HISTORY）

本文件记录每一步的范围、产出、关键决策。
**新会话恢复时先读本文件 + `CLAUDE.md` / `AGENTS.md` 就能拿到完整上下文。**

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

## Step 7 — 真实手牌历史与微缩卡牌平铺（2026-05-22，commit `3a39b86`）

**目标**：新增身份鉴权的 `GET /api/history` Express API，拉取当前玩家 SQLite 历史记录；自适应升级 SQLite 数据库保存物理座位号 `seat_id` 以精准行动分析；前端对接真实数据并以 premium 微缩卡牌渲染底牌与公共牌。

**产出**：
- `server/db.js` — 增加物理座位号 `seat_id INTEGER DEFAULT 0`，加入 `ALTER TABLE` 零停机热升级机制；更新插入与持久化事务参数以落库 `seatId`。
- `server/auth.js` — 新增带 `requireAuth` 中间件的 `GET /api/history` 路由。引入 `evaluate7` 进行牌力动态推导，根据结算结果与个人行动记录（弃牌、摊牌等）智能生成极富质感的中文描述摘要（如“对手全弃牌，赢得底池”、“在 翻牌圈 弃牌”、“进入摊牌胜出，牌型【两对】”）。
- `public/style.css` — 追加手牌历史中 inline 渲染微缩卡牌的 `.history-cards`、`.history-cards-group` 和 `.history-cards-label` 样式布局。
- `public/js/app.js` — 彻底移除 `_loadHistory` 中的 fake dummy 数据，改用真实的异步 API fetch 交互；重构 `_renderHistory` 渲染器，动态渲染 wins/total/winrate/chips 以及将 `hole_cards` 与 `community_cards` 用微型卡牌平铺（支持 ♥♦ 红色花色自适应加红样式），实现极佳 of 优秀的视觉与动感交互。
- `scripts/test-step7-history.js` (新) — 新增 Step 7 完整的端到端自动化集成测试脚本，模拟注册登录、多场景手牌历史数据（摊牌赢、全弃赢、不同街弃牌、摊牌落败等）自动解析、卡牌格式校验与数据库断言。

**关键决策**：
- **热升级防覆盖**：使用 `ALTER TABLE` 包裹在 `try...catch` 中进行热升级，在不覆盖/损坏已有测试开发库的前提下优雅加入 `seat_id` 物理列。
- **动态推导与中文描述**：不重复存储牌型名称，在查询历史时根据底牌+公共牌动态调用扑克引擎进行 `evaluate7` 算力推演，保证绝对的一致性并实现高保真的智能行动中文摘要。
- **Premium 卡牌自适应**：前端重用原有的 `.card.sm` 类与 `_cardInnerHTML` 卡面渲染逻辑，完美契合已有 UI 视觉设计。

**测试验证**：
- 运行 `npm test`，核心引擎的 48 个德州规则及结算单元测试 100% 通过。
- 运行 `node scripts/test-step6-e2e.js`，3人局自动下注、摊牌与入库断言 100% 成功。
- 运行 `node scripts/test-step7-history.js`，包含各种结局的历史记录拉取、中文推算描述、日期格式、字段结构等断言 100% 通过。

---

## Step 8 — 客户端视觉美化、高保真音效、粒子弹力反馈与离线自动托管机制优化（2026-05-22，commit `60c3fe8`）

**目标**：提升游戏桌面的现代质感与声音反馈；并实现 P0 级玩家离线/主动退出托管优化，彻底防止由于玩家挂起或断线导致的游戏长时间等待或锁死。

**产出**：
- `public/style.css` — 
  - 新增高透磨砂置顶扁平化结算通知条样式（`.settlement-overlay`），支持高雅绿/尊贵红/奢华金发光色阶、极细平滑自倒计时进度条，支持全屏视口 100% 物理可见。
  - 新增席位离线高对比度灰度置灰样式（`.player-seat.offline` / `.hero-zone.offline`）。
  - 新增精致白色边框的霓虹发光红“离线”微型状态角标（`::after` 动态状态字样）。
  - 追加粒子筹码和席位头像三维受压果冻弹性动画样式（`.bump`、`@keyframes`）。
  - **【新增优化】** 将 `.player-seat` 的 `z-index` 提高至 `20`，确保其绝对不受椭圆牌桌遮挡；精调五个对手席位（`#seat-1` ~ `#seat-5`）布局坐标，将其向外侧拉开距离，使牌桌极具开阔感与和谐感。
- `public/js/app.js` — 
  - 接入 Web Audio API 纯原生算法合成的高保真 100% 零延时扑克声效（发牌摩擦、筹码撞击、叩击桌面、纸张弃牌）。
  - 智能 Fallback 爵士乐背景音乐合成器：默认读取高雅爵士乐音频，若网络断开或被浏览器拦截，自动启用 96 BPM 的低频 Rhodes、木贝斯走线与爵士镲摇摆节奏的算法合成爵士乐。
  - 筹码雨粒子数量升至 22 颗，重写 3D 偏置爆破与抛物坠落算法，并在撞击瞬间调用受压弹性物理动效与碰撞音效。
  - 在 `updatePlayerSeat`、`_updateHero` 和 `clearPlayerSeat` 挂载 `player.isOffline` 判断，实现秒级状态置灰与角标清除。
- `server/table.js` — 
  - 智能计算 `socketIds.size === 0` 注入 `isOffline: true` 并深克隆包装广播给客户端，免除大范围侵入引擎状态。
  - 重构 `startActionTimer`，对离线玩家的思考时限从 30 秒自动缩短为 **2 秒（2000毫秒）**，并向客户端动态同步 `timeLimit`；若在自身回合断开，立刻触发 2s 超速计时器托管。
  - 重构 `sitPlayer` 连接恢复模块，当离线玩家在其思考回合内连回，立刻清除托管计时器、移除置灰标记，并将其重新恢复为饱满的 30 秒思考时限。
  - **【新增修复】** 在 `translateGameState` 座位绝对转相对的方法中，加入对 `state.results.summary` 和 `state.results.hands` 内 `seatId` 座位号的转换逻辑，彻底解决了局终结算筹码雨飞向赢家上家（绝对座位号）而非赢家本家（相对座位号）的结算动画 Bug。

**关键决策**：
- **2秒黄金时限**：2秒既能保证在线玩家近乎无感，又能提供合理缓冲区供掉线玩家瞬间刷新 Tab 重新加载。
- **纯代码 Web Audio 合成音效**：完全免除网络延迟、CDN 失败或文件加载失效风险，100% 离线自给自足。
- **深克隆防指针污染**：对 `game_state` 与 `new_hand` 推送广播包前执行深克隆，杜绝多物理客户端 enrichment 时发生指针交叉修改污染。

**测试验证**：
- 运行 `npm test`，全部 50/50 单元与 E2E 自动化测试用例（包括 Alice, Bob, Charlie 对局演练、SQLite 筹码持久化与中文战绩生成）全部 100% 绿灯通过。

**已知问题 & 待解决任务**：
- **离线无弹窗/全局强通知**：当牌局中一方玩家离线时，另一方玩家席位虽有置灰/角标，但没有屏幕中心悬浮弹窗或醒目文本直接呼脸警示离线。
- **单人尬等死局**：当牌局结束、有玩家离线退出导致桌上仅剩唯一一名玩家时，客户端没有弹出“等待玩家进入”的大厅弹窗或阻断页面，导致该唯一玩家留在桌上莫名其妙尬等。需要在此场景下优雅阻断或重回大厅准备态。

---

## Step 9 — 实时明牌管理后台与系统日志终端开发（2026-05-23，commit `75ceac8`）

**目标**：开发一个独立、低延迟、高保真的管理员后台系统。支持全场底牌绝对明牌监视、大厅在线统计、SQLite 审计流水流水，AFK/异常玩家一键 Kick 清障，并在控制台设计实时 Linux 风格系统日志滚动终端。

**产出**：
- `server/table.js` —
  - 开发了 `getAdminState()` 方法，完整提取绝对座位席（明牌所有手牌 `holeCards`）、Spectators 在线情况和 SQLite 系统级筹码/用户体量。
  - 精修 `kickPlayer()` 强制弃牌与流转逻辑，彻底修复了因在引擎响应前手动标记 folded 导致 `game.act()` 报错卡死当前回合的 Bug；优化非回合内被踢流程，使被踢玩家和其余人上线均能秒级秒级就位，牌桌秒级无感清障。
- `server/admin-socket.js` (新) —
  - 独立挂载 `/admin` 安全 Socket.IO 命名空间，实现绝对高机密数据的物理隔离。
  - 通过全局代理全局 `console.log` 与 `console.error` 方法，并使用 **防循环重入锁机制**，将系统控制台输出秒级实时推送到 `/admin` 广播通道，供管理后台进行全权审计。
- `server/index.js` — 挂载管理员独立的免密路由路径 `/admin`，加载 `public/admin.html`。
- `public/admin.html` (新) —
  - 开发了磨砂玻璃拟态暗黑面板，顶置全服总资金及大厅指标看板。
  - 绘制微缩绿色牌桌，环绕席位以明牌面朝上呈现底牌，并集成挂载一键红色 Kick 按钮。
  - **【布局与性能优化】** 将 **Live Terminal 控制台日志窗口** 从右侧小栏重构至左侧牌桌监控正下方，横向宽度调整为与牌局监控屏一致，高度固定为 320px 限制无限长延伸，解决极端对局日志量过大破坏后台整体版面平衡的问题。
  - **【本地大容量缓存与零负载导出】** 新增 **"导出日志 TXT"** 按钮，前端新增全局 `window.adminLogBuffer` 内存滑动缓存机制（智能记录最新 1000 条控制台历史），点击即可在客户端零负载、零延迟安全导出生成 `.txt` 文本文件下载。
  - **【右侧侧边栏自适应拉伸】** 调整大厅旁观者列表面板样式，使其在 CSS Grid 中纵向 flex 自动填充满高度，完美契合左侧重组后的高度平衡，实现极佳的 UI 质感与对称性。

**关键决策**：
- **安全数据隔离**：使用独立的 `/admin` 命名空间，完全不通过玩家默认通道推送底牌数据。
- **防止递归防重入锁**：在全局 console 挂载时加入重入状态标识 `isLoggingGuard`，彻底避免 Socket 发送日志本身导致死循环或内存栈溢出的严重崩溃。
- **终端自动剪枝与零负载导出**：前端控制 DOM 行数不超过 250 行，控制台导出完全基于前端 `window.adminLogBuffer` 滚动保存的最近 1000 条日志流，避免因查库或频繁读取大日志文件给 Node 服务端带来任何磁盘 I/O 损耗。DOM 和缓存数组均设置独立上限，坚决杜绝前端内存/浏览器抖动卡顿。

---

## Step 9.1 — 客户端牌局视觉优化与管理员极速充值系统开发（2026-05-23，commit `4e73676`）

**目标**：全面提升客户端牌局可读性、参与感与视觉质感；并支持管理员在线中途极速为玩家充值（Buyin）以及全桌强弹窗模态宣告。

**产出**：
- `public/index.html` —
  - 引入了底部毛玻璃 `.game-footer` 容器（含常驻 Rank 规则与滚动走马灯跑马灯系统提示）。
  - 在牌桌奖池下方加入了 `#turn-indicator` 行动回合状态指示器。
  - 引入了 `#global-alert-overlay` 全局霸气磨砂霓虹大弹窗。
- `public/style.css` —
  - 编写底栏、牌型排行与走马灯左右跑马灯滚动样式。
  - 编写牌桌中央回合指示器（支持 `.my-turn` 金黄呼吸脉冲与 `.opponent-turn` 的暗淡色效对齐）。
  - 编写了 `.action-float-text` 头像动作 3D 上浮、位移并淡出销毁的高对比度发光样式。
  - 编写了全服大模态弹窗的高保真发光与缩放跳弹浮现效果。
- `public/js/socket.js` — 绑定了 `global_notification` 服务端全局推送事件。
- `public/js/app.js` —
  - 实现 `updateGameState(state)` 对中央回合指示器的即时文字与状态更新。
  - 实现了 `onPlayerAction(data)` 中动态创建飘字气泡、动画挂载与超时 `1.1s` DOM 销毁内存防泄漏机制。
  - 增加了全局通知大弹窗 `showGlobalNotification` 的渲染、本地玩家筹码秒级自同步与 `5s` 自动隐藏。
- `server/table.js` —
  - 开发了核心充值 `adjustPlayerChips(username, amount)` 方法，实现 safe SQL 写盘持久化。
  - 完美同步了大厅、旁观与席位筹码；若该玩家当前正在手牌内打牌，**智能实时挂载加码到德州引擎的活跃筹码上**，实现中途Buyin立即在下一秒 of 随后决策中起效。
  - 执行 `this.broadcast('global_notification', ...)` 进行全局弹窗广播通知。
- `server/admin-socket.js` — 挂载管理员 `/admin` 命名空间下的 `admin_adjust_chips` 接收网关，校验合法后调 table 层方法。
- `public/admin.html` —
  - 席位下方悬浮渲染了包含输入框、确定与 `+500` 金色发光按钮的极速充值条，设计紧凑且不阻挡手牌。
  - 绑定充值指令发送与 `admin_action_result` 回执后的 showToast 实时正向声讯反馈。

**关键决策**：
- **实时德州引擎芯片挂载**：改变了原本“充值只在下局起效”的弊端。我们在修改物理座位筹码的同时直接对 `this.game.players` 内当前局的 `chips` 做出累加，使其瞬间参与到当前的 Call / Raise 行动的边界验证中。
- **本地滑动内存缓存**：前端走马灯使用纯 CSS animation 实现，而全局充值弹窗设置 5 秒自动消退和行内手动关闭，体验极为饱满。

---

## Step 9.2 — 牌型规则卡牌化展开、结算赢家底牌物化、HUD 悬浮面板防遮挡重构与高 DPI 全局字号放大（2026-05-23，commit `083389b`）

**目标**：提升对局终盘透明度与直观可读性，打造奢华的德州终局体验；**彻底解决在大屏与常规视口下，实时筹码榜及行动日志与左右侧座位重叠遮挡的适配痛点**，将左右面板重构为悬浮式 HUD。

**产出**：
- `public/index.html` —
  - 底部德州牌型规则添加了 `🔍 牌例：展开/收回` 独立切换按钮与微缩物理卡牌大厅容器 `#rules-card-showcase`。
  - 中央结算大弹窗中设计了赢家摊牌物理扑克明牌展示槽 `#settlement-winner-cards`。
- `public/style.css` —
  - **【HUD 浮窗布局重构】** 将 `.left-sidebar` (实时筹码榜) 与 `.right-sidebar` (本局行动日志) 从普通的 side-by-side flex 布局重构为绝对定位 `.game-sidebar` HUD 面板。
  - 实时筹码榜绝对浮动在 `.game-main` 的 **左上角** (`left: 20px; top: 20px;`），行动日志绝对浮动在 **右上角** (`right: 20px; top: 20px;`）。宽度收窄为 230px 和 250px，高度固定为 220px 配合内滚动，彻底释放了中央 `.table-scene` 椭圆牌桌的空间，与左右侧的玩家座位框绝无重叠遮挡风险！
  - 编写了极具视觉张力的浮窗毛玻璃特效（`.game-sidebar` 支持 `rgba(15, 23, 42, 0.75)` 背景、16px 磨砂模糊滤镜与金色流光发光 hover border），并设计了排行榜金色名次框与日志类型发光竖边条（`.log-row` 支持 `.fold`, `.call`, `.raise`, `.allin` 发光指示）。
  - 全面升级全局字号：坐席玩家昵称、筹码量、顶部看板和底部操作面板整体字号加大 15%-25%；重点特大化 Hero 本人底部的名字与筹码字号，防止高 DPI/移动端眯眼看牌。
  - 设计超微型扑克牌样式 `.card.xs`，设计微缩花色 and 自适应字体，融入底栏。
- `public/js/app.js` —
  - 绑定 `#btn-toggle-rules` 点击事件，实现手牌图例的平滑伸缩（默认折叠）。
  - 精修结算流程 `_showSettlementOverlay(results)`：自动解析 `results.hands`，在 showdown 时物理绘制渲染赢家胜出的 5 张扑克明牌及高亮发光描边。
  - 前端结算倒计时动画与移除定时器时间从原 `6.0s` 完美拉伸至 `7.5s` - `7.7s`，完美契合 8 秒节奏。
- `server/table.js` —
  - 将 showdown 结算的休眠清场延迟调大至 `8000` ms。

**关键决策**：
- **HUD 悬浮面板与自适应避让**：通过将实时筹码榜和行动日志重构为绝对定位的高透磨砂 HUD 面板，并放置在游戏主框的左上角与右上角，成功在极度受限的对局视口下达成了“既能常驻展示、又绝不遮挡任何物理座位”的完美效果。同时，设计了 `@media (max-width: 1380px)` 自适应响应式适配，在视口宽度不足 1380px 时自动隐藏面板以最优先保障椭圆牌桌操作的核心体验。
- **微缩牌型大厅**：每个牌型不仅是文字，而是采用超微型扑克 `.card.xs`（25px宽，38px高）以物理图形形式展现。利用绝对定位悬浮在规则条上方，展开时不占用界面任何排版空间，默认收回，体验干净纯粹。
- **赢家物理明牌摊牌**：摊牌（Showdown）结算时，在面板中央渲染出赢家的这 5 张组合牌（含高亮金色呼吸霓虹框），彻底免除“不知道别人赢的是什么牌”的痛点。
---

## Step 9.3 — 牌局显示与交互优化及头像清空Bug修复（2026-05-23，commit `8986e8a`）

**目标**：针对牌局的用户体验和界面信息清晰度进行4项关键交互与视觉优化，同时解决玩家头像清空导致的致命 JavaScript crash Bug。

**产出**：
- `public/style.css` — 
  - 全局微调并增加字号（头像昵称、筹码值、计时器、重点特大化 Hero 底部信息字号等），提升特大屏/高 DPI 分辨率下的可读性。
  - 重定义 `.pos-badge` 样式（D/SB/BB/UTG 标识），取代废弃的圆形 dealer 徽章。
  - 新增亮牌与盖牌选择容器 `.show-muck-area` 及对应按钮样式（`.btn-show-hand`，`.btn-muck-hand`）。
  - 新增 5+2 结算组合卡牌样式（`.settle-card-stage`, `.settle-card-row`），引入最优5张牌高亮发光描边 `.card-highlight` 和非贡献卡牌半透明暗淡置灰 `.card-dimmed`，以及底牌由下往上渐现飞入动画 `.hole-fly-in`。
- `public/index.html` — 
  - 彻底移除了原 HTML 结构中所有物理坐席及 Hero 坐席内的圆形 `<span class="dealer-btn" hidden>D</span>`。
  - 在结算大弹窗（`.settlement-box`）中加入了亮牌/盖牌操作区域 `#show-muck-area`。
- `public/js/app.js` — 
  - 移除了 `updatePlayerSeat`、`_updateHero` 中操作被废弃 D 圆圈的代码。
  - **【致命Bug修复】** 彻底删除了 `clearPlayerSeat` 中尝试对已被移除的 dealer-btn 执行 `.hidden = true` 导致的 `TypeError: Cannot set properties of null (setting 'hidden')` 报错。该报错原本会在有玩家离开或局终清空非本局玩家时彻底打断 `updateGameState` 执行流，导致 Hero 自己再也无法展示手牌。
  - 绑定亮牌与盖牌按钮，亮牌向服务端发送 `show_hand` 事件；如果本人已在 showdown 被摊牌，或者未参与本手牌局，自动隐藏亮牌选项。
  - 新增 `onPlayerShowHand(data)` 方法，用于在结算期间实时将亮牌玩家的手牌明面渲染到其对应的对手卡牌席位上。
  - 重写了结算大弹窗中关于赢家卡牌展示的渲染逻辑，由 5 张公共牌（上排）+ 2 张赢家底牌（下排）构成 5+2 画面。底牌依次播放延迟飞入动画，1.5 秒后动态匹配并高亮选出拼成最优牌型的 5 张扑克，同时压暗非最佳贡献 of 2 张扑克，并弹出金色发光的牌型评级字样。
- `public/js/socket.js` — 
  - 增加了 `SocketClient.emit.showHand()` 亮牌网络交互网关。
  - 增加了 `player_show_hand` 服务端推送事件的监听处理，路由直连 `App.onPlayerShowHand`。
- `server/table.js` — 
  - 增加了 `_lastHandPlayers` 牌局结算时玩家手牌及信息的安全深拷贝快照（在重置 `this.game = null` 之前保存），并在 8 秒延迟下一局开始时主动清理，彻底保证状态隔离。
  - 维护 `_shownHands` 独立内存记录以防单玩家恶意重复亮牌。
  - 实现了 `handleShowHand(socket)` 服务端校验模块：校验当前是否处于结算期、该物理座位是否有可亮手牌、是否重复提交，并将亮牌数据广播发送给全桌玩家。
- `server/lobby.js` — 
  - 在 Socket.IO 物理连接中，将 `show_hand` 指令进行网关路由，直连 table.handleShowHand 处理器。

**关键决策**：
- **5+2 动态演变流程**：采用“公共牌平铺 + 2张底牌浮现 + 1.5秒后最强5张金色霓虹高亮/其余极简暗淡 + 牌型级别淡入”的三阶段动态演进，能让玩家在 0.5 秒内极速感知赢家是如何组合出最大手牌的，可读性产生质的飞跃。
- **亮牌与盖牌的权限隔离**：赢家在结算时会自动进行 Showdown 摊牌，因此赢家无需再点击“亮牌”。本功能只提供给盖牌或输掉的活跃玩家，提供他们炫耀或展示欺骗（Bluffing）的交互可能，且在下一局开始时（8秒服务器延迟到期后）所有亮牌数据自动从内存彻底清空销毁，坚决保证对局绝对公平性。
- **Bug 根源排查与彻底解决**：`clearPlayerSeat` 闪退崩溃的根本原因是将旧 DOM 结构（圆形 D）彻底删除了，但在清空座位的公用方法中依然保留了对该元素的直接隐藏调用，这种“漏网之鱼”在玩家离座或牌局重启时发生，导致后续的所有 `_updateHero` 英雄手牌刷新被迫中断。删除此垃圾调用后，前端所有手牌流完美重归顺畅。

---

## Step 9.4 — 核心游戏引擎致命漏洞修复、皇家同花顺强化与 Option A 高级扑克规则集成（2026-05-24，commit `5d31204`）

**目标**：立即修复核心游戏引擎中影响稳定性的死锁崩溃漏洞及边池退款漏洞，集成 Option A 高级德州扑克规则，增强皇家同花顺命名与视觉快照。

**产出**：
- `server/engine/game.js` — 
  - **【致命漏洞修复】** 构造器尾部增加对当前活跃（`'active'`）玩家数判定。若下盲注后仅剩 0 或 1 名活跃可行动玩家（如盲注 All-in 场景），立即执行 `_runOutAndShowdown()` 自动发牌并结算，彻底解决游戏停留在翻牌前街、等待 All-in 玩家操作而产生的死锁问题。
  - **【Option A 规则一集成】** Heads-up 双人局盲注上限自适应：若短堆玩家 chips 不足大盲，盲注上限自缩减为短堆筹码数，SB 相应削减，彻底避免大堆多付跟注款。
  - **【Option A 规则二集成】** 不完整加注重启加注限制：引入 `isRaiseLocked` 加注锁定标志。Check / Call / Raise 后玩家自动锁定；仅当加注的筹量增量 $\ge$ 当前 `minRaise`（即完整加注）时才为其他玩家重新打开行动。短堆微小 All-in 将无法重新打开已表态玩家的加注选项。
  - **【Option A 规则三集成】** 平分底池时，获取顺时针方向的座位列表，使得 winners 数组按到庄家左手侧顺时针相对距离排序，底池余数筹码（Odd Chip）精准倾斜给位置最劣势活跃赢家。
- `server/engine/pot.js` — 
  - **【严重漏洞修复】** 重构 `computePots` 边池算法。当某一籌码高度分池仅有 1 人贡献时（即为 Uncalled Bet 未跟注筹码），即使该出资玩家由于断线托管弃牌，该底池的 `eligibleIds` 也强行锁定为其本人，确保在结算时将此筹码退回，彻底阻断筹码被旁人“盗取”的算法漏洞。
- `server/engine/hand-rank.js` — 
  - 在 `evaluate7` 中加入皇家同花顺（花色相同、顶牌为 A 的同花顺）独立判定，覆盖将 `categoryName` 强化标识为 `'皇家同花顺'`，前台与 Hero 实时牌型同步显示。
- `server/table.js` — 
  - 构造 `Game` 实例后检测 `game.phase === 'ended'`，若游戏在初始化时已直接进入结算，立即触发 `saveAndSettleHand()` 进行入库和下一局延时，不开启行动计时器。
- `server/engine/game.test.js` — 
  - 补充 5 组针对上述边界和漏洞的 Rigorous 单元测试用例，覆盖盲注 All-in 自动摊牌死锁崩溃测试、未跟注筹码 fold 自动退回测试、皇家同花顺命名测试、双人对决盲注上限测试、不完整加注目光判定测试、余数筹码顺时针位置分配排序测试。所有 53 个引擎单元测试已 100% 绿灯全部跑通。

**关键决策**：
- **致命崩溃修复链路**：对于 blind-allin 死锁崩溃，在引擎内执行 auto-showdown 改变状态，并在 `table.js` 直接检查 settled，确保不卡在 preflop，消除了定时器崩溃隐患。
- **Uncalled Bet 绝对归属**：采用 `remaining.length === 1` 来判断未跟注筹码层，使之成为独立 pot 锁定 eligible 给原玩家，这是分池算法中最优雅且规则完全精确的解法。
- **加注锁的优雅状态机管理**：直接以 `isRaiseLocked` 实现加注状态记录，在 flop/turn/river 重置，免去了复杂的 street 嵌套追溯。

---

## Step 9.5 — 多 Agent Git 分支与 Worktree 协作体系（2026-05-24，commit 本次提交）

**目标**：项目后续会由 Codex、Claude Code、Antigravity 继续共同开发。为避免多个 coding agent 在同一个工作目录里互相覆盖未提交变更，建立稳定的 Git 分支策略与独立 worktree 工作区布局。

**产出**：
- Git 分支：
  - `main` — 稳定主干，保持可部署状态。
  - `next` — 集成分支，所有 agent 的任务分支先合入这里，测试通过并经人工决策后再合入 `main`。
  - `codex/work` — Codex 起步工作分支。
  - `claude/work` — Claude Code 起步工作分支。
  - `antigravity/work` — Antigravity 起步工作分支。
- Git worktree：
  - `F:/antigravityProject` → `main`
  - `F:/antigravityProject-codex` → `codex/work`
  - `F:/antigravityProject-claude` → `claude/work`
  - `F:/antigravityProject-antigravity` → `antigravity/work`
- `CLAUDE.md` / `AGENTS.md` — 增补统一的分支策略、worktree 使用说明、合并流程、环境配置边界。
- `scripts/export-git-history.js` + `npm run export-git` — 增加可选的 Git 提交历史导出工具；生成文件 `GIT_HISTORY_CHANGELOG.md` 是本地可再生文档，不纳入版本控制。
- `.gitignore` — 忽略 `GIT_HISTORY_CHANGELOG.md`，避免生成物污染提交列表。

**关键决策**：
- **不要让多个 agent 共享同一个工作目录开发**。一个 Git 工作目录同一时间只能 checkout 一个分支，多 agent 共用 `F:/antigravityProject` 会导致未提交变更互相覆盖。以后各 agent 默认进入自己的 worktree 目录工作。
- **每个任务仍应再切短生命周期任务分支**。`codex/work` / `claude/work` / `antigravity/work` 只是起步分支；正式任务建议从 `next` 派生为 `codex/<task>`、`claude/<task>`、`antigravity/<task>`。
- **`main` 不直接承接实验开发**。agent 任务分支先合入 `next`，跑测试、人工验收后再由 `next` 合入 `main`。
- **环境差异不靠长期分叉分支保存**。线上密钥、`.env`、VM Nginx/PM2 实际配置、SQLite 数据库文件不进入 Git；可提交 `.env.example`、部署模板和部署文档。游戏功能代码要经常从 `next`/`main` 合并同步。
- **`HISTORY.md` 由合并者统一维护**。多 agent 同时改文件尾部很容易冲突，重要 step 在合入 `next` 或 `main` 时统一追加记录。

**操作记录**：
- 已从 `main` 创建 `next`。
- 已从 `next` 创建 `codex/work`、`claude/work`、`antigravity/work`。
- 已创建三个独立 worktree 目录，分别给三个 agent 使用。
- 保留旧 worktree `F:/ClaudeCodeProject/.claude/worktrees/elegant-perlman-a6c72c`，未做清理。

---

## Step 9.6 — GitHub 远端仓库初始化与 GitHub CLI 配置（2026-05-24，commit 本次提交）

**目标**：把本地 Poker Night 项目正式放到 GitHub 私有仓库，并让本机命令行 `gh` 可用于后续创建 PR、查看 Actions、管理远端仓库。

**产出**：
- GitHub 私有仓库：`jchensh/texas-holdem`
  - 仓库地址：`https://github.com/jchensh/texas-holdem`
  - 默认分支：`main`
  - 可见性：Private
- 本地 Git remote：
  - `origin` → `https://github.com/jchensh/texas-holdem.git`
- 已推送远端分支：
  - `main`
  - `next`
  - `codex/work`
  - `claude/work`
  - `antigravity/work`
- GitHub CLI：
  - 安装位置：`C:/Users/user/AppData/Local/Programs/GitHub CLI/bin/gh.exe`
  - 已加入用户级 PATH，新开 PowerShell 后可直接运行 `gh`
  - 已登录账号：`jchensh`
  - Git 协议：`https`
  - Token scopes：`gist`、`read:org`、`repo`、`workflow`

**关键决策**：
- **仓库先设为私有**。当前是朋友间联机娱乐项目，包含部署与账号体系雏形；V1 稳定前先保留私有仓库更稳妥。
- **保留 HTTPS Git 协议**。`gh auth login` 已配置 Git operations protocol 为 `https`，不额外引入 SSH key 管理复杂度。
- **把固定协作分支一起推上 GitHub**。这让远端仓库与 Step 9.5 的多 agent 分支策略保持一致，后续可以直接从 `next` 派生任务分支。
- **不上传本地生成物和敏感文件**。`.env`、SQLite 数据库、`node_modules/`、`GIT_HISTORY_CHANGELOG.md`、agent 本地目录均由 `.gitignore` 排除。

**操作记录**：
- 使用 GitHub CLI 创建私有仓库 `jchensh/texas-holdem`。
- 将本地 `origin` 绑定到新仓库。
- 推送 `main` 并设置 upstream。
- 推送 `next`、`codex/work`、`claude/work`、`antigravity/work` 并设置 upstream。
- 将 portable `gh` 从 `C:/tmp/ghcli` 整理到用户程序目录，并写入用户级 PATH。

**验证记录**：
- `gh auth status` 在新 PowerShell 中确认已登录 `jchensh`。
- `gh` 在新 PowerShell 中可直接显示帮助菜单，说明 PATH 生效。
- `git remote -v` 显示 `origin` 指向 `https://github.com/jchensh/texas-holdem.git`。
- `git branch -vv` 显示 `main`、`next`、`codex/work`、`claude/work`、`antigravity/work` 均已追踪对应远端分支。
- 引擎单元测试 `node --test server/engine/*.test.js`：53/53 通过。

---

## Step 9.7 — 玩家离线/重连全局强通知弹窗（2026-05-24，commit 本次提交）

**目标**：补齐 Step 8 遗留的「离线无弹窗/全局强通知」问题——牌局中玩家彻底掉线时，桌上其余玩家除了席位置灰 + 霓虹角标外，还应收到一个屏幕中央的「呼脸」级别全局弹窗；该玩家重连回桌时再弹一条对称的「回归」提示。

**产出**：
- `server/table.js` —
  - `handleDisconnect`：玩家彻底断开（`socketIds.size === 0`）且手牌进行中时，在原有 `broadcastGameState()` 置灰之后，追加广播一条 `global_notification`（`type: 'offline'`）。掉线玩家此刻已无 socket，`broadcast` 只会发给桌上其余在线玩家。
  - `sitPlayer` 物理座位重连分支：在 `socketIds.add()` **之前**捕获 `wasOffline`，仅当该玩家此前确实彻底离线、且手牌进行中时才广播 `global_notification`（`type: 'online'`），避免多 Tab 重复连接误弹。
- `public/index.html` — 给 `#global-alert-overlay` 内写死的图标 `<div class="global-alert-icon">` 加上 `id="global-alert-icon"`，使其图标可按通知类型动态切换。
- `public/js/app.js` — `showGlobalNotification` 重构为「类型 → 标题/图标/音效」映射表，新增 `offline`（📡 玩家掉线警示 / ⚠️ / fold 音效）与 `online`（🟢 玩家回归牌桌 / 🔌 / check 音效）两种类型，保留 `buyin` 与默认系统广播；5 秒自动关闭逻辑对所有类型通用。
- `scripts/test-offline-notify.js`（新）— 离线/重连全局通知端到端集成测试。

**关键决策**：
- **复用现有弹窗机制**：直接复用 Step 9.1 已建好的 `global_notification` → `showGlobalNotification` → `#global-alert-overlay` 全屏中央模态链路，不新增前端组件。弹窗仍为全屏阻塞模态（与管理员充值 buyin 同款），已与用户确认接受此形式。
- **重连守卫**：`wasOffline` 必须在 `socketIds.add()` 之前判定，否则永远判不出「曾经离线」；并以此过滤掉多 Tab 重复连接的误弹。
- **范围**：本次只做离线/重连弹窗；Step 8 的另一条遗留「单人尬等死局」按用户要求暂不处理。

**测试验证**：
- `npm test`：引擎/单元 53/53 通过（本次未改引擎，无回归）。注：`node --test` 会一并发现 `scripts/test-*.js`，这些需要 live server 的 E2E 脚本在 `npm test` 下报红属预期，应手动起 server 单独运行。
- `node scripts/test-offline-notify.js`（live server）：断言掉线/重连两条通知均被桌上其余玩家收到、类型与文案正确，全部通过。
- `node scripts/test-step6-e2e.js` / `test-step7-history.js`（fresh server 各自单跑）：核心对局流与历史接口无回归通过。
- 浏览器预览：手动渲染 offline / online 两种弹窗，标题、图标、加粗文案、布局均正确。

---

## Step 9.8 — 未来前端与后端架构路线文档（2026-05-24，commit 本次提交）

**目标**：把关于项目未来演进的讨论沉淀成独立路线文档，避免长期构想散落在会话上下文里；同时明确当前最重要的近期目标不是继续扩功能或重写前端，而是先完成 V1 部署上线。

**产出**：
- `FutureRoadmap.md`（新）—
  - 总结短中长期路线：V1 部署上线、V1.5 前端治理、V2 React + TypeScript 应用壳、V2.5+ PixiJS 牌桌渲染层。
  - 解释 DOM、React、PixiJS 在长期架构里的职责边界。
  - 明确 PixiJS + DOM/React 是比直接上 Cocos / Godot 更贴合网页德扑的长期方案。
  - 记录后端配套升级方向：Socket 协议文档化、`handId + seq`、`game_state` 与 `game_event` 分离、`GET /api/table/state`、timeline 复盘数据、未来 `TableManager` 多桌化。
  - 明确 PixiJS 只负责动画演出，服务端仍是唯一游戏真相来源。

**关键决策**：
- **当前第一优先级仍是 V1 部署上线**。现阶段最重要的是把已有单桌德州扑克、账号、Socket.IO、SQLite 历史、断线重连和管理能力在谷歌云香港 VM 上跑通，而不是立刻引入 React、PixiJS 或游戏引擎重构。
- **长期前端推荐走 PixiJS + DOM/React 混合架构**。React/DOM 负责登录、历史、后台、HUD、按钮、弹窗等网页 UI；PixiJS 负责牌桌、卡牌、筹码、粒子、发牌与结算演出。
- **后端必须保持裁判地位**。所有规则、行动合法性、结算、筹码、历史落库都由服务端决定；前端渲染层只消费服务端快照和事件流。
- **大重构排在部署验证之后**。V1 之前不做全量 React 重写、不引入 PixiJS 到主流程、不做 Cocos/Godot、不做多桌。

---

## Step 10 — 谷歌云香港 VM 生产部署与 HTTP 纯 IP 访问 Session Cookie 修复（2026-05-24，commit 本次提交）

**目标**：在谷歌云香港 VM 实例（GCP CE `e2-small`）上完成 Poker Night 游戏服务端的生产部署，建立自动进程守护与 Nginx 反向代理，并修复因纯 IP HTTP 协议访问导致的 Session Cookie 被浏览器丢弃、无法登录与握手失败的致命 Bug。

**产出**：
- `server/index.js` — 将 `cookie-session` 里的 `secure` 限制从 `config.NODE_ENV === 'production'` 调整为 `false`，放行 HTTP 协议下的 Cookie 传输，完美打通公网 IP 裸跑测试。
- `DEPLOY.md` — 提供了极其详尽的谷歌云（GCP CE）生产环境部署与运维手册，包含系统依赖、PM2、Nginx、数据备份、SSL证书配置说明。
- `ecosystem.config.js` — PM2 进程守护配置文件，为多核环境与自动重启保驾护航。
- `poker-night.nginx.conf` — 针对域名 SSL 的 Nginx 配置模板（带 HTTPS 强转和 WebSocket 升级）。
- `scripts/deploy.sh` — 全自动一键编译、安装生产依赖、热重启与 PM2 状态保存脚本。
- **临时 IP Nginx 代理配置文件（自动生成）** — 云端自动生成 `/etc/nginx/sites-available/poker-night-ip` 配置文件，实现纯公网 IP 下的 Nginx 反代与 WebSocket 升级。

**关键决策与 Bug 排障记录**：
- **Session Cookie HTTPS 限制排障（P0 级大坑）**：由于 `.env` 中 `NODE_ENV` 设为 `production`，`cookie-session` 默认将 `secure` 设为 `true`（限定 HTTPS）。在使用公网 IP (`http://34.92.181.190`) 访问时，浏览器因为普通 HTTP 协议直接无情丢弃了 Set-Cookie，导致后续的所有 `/api/me` 和 Socket.IO 握手都遭遇 `未登录` 拦截。通过将 `secure` 设为 `false` 完美解决了此问题。
- **未推送代码排障**：在部署前期，发现由于本地 `next` 分支领先远端 `origin/next` 2 个 commit，导致云服务器拉取不到 `deploy.sh`。在本地手动执行 `git push origin next` 后，云端 `git pull` 同步成功。
- **一键开机自启**：配置了 `systemd` 引导的 PM2 守护服务 `pm2-cqy95106.service` 并通过 `pm2 save` 冻结对局进程，防机房断电与宕机。

**测试验证**：
- 云端 `git pull origin next` 后运行 `./scripts/deploy.sh` 一键部署，`pm2` 与 `nginx` 双绿灯状态，浏览器通过公网 IP 完美流畅开玩，握手正常，状态秒级接通！

---

## Step 11 — 专属域名绑定、HTTPS 证书配置与 WebSocket 安全升级（2026-05-25，V1 版本完美收官）

**目标**：为部署在谷歌云香港 VM 上的游戏平台绑定自定义专业域名 `jeffgame.tech`（二级域名 `poker.jeffgame.tech`），配置免费的 Let's Encrypt SSL 安全证书以实现全站 HTTPS 加密访问，并彻底升级 Socket.IO 的安全 WebSocket（`wss://`）长连接；同时理清 Nginx 代理与 Certbot 冲突引起的重定向循环及 IP 访问 404 等典型生产环境 Bug，标志着 Poker Night V1 版本完美收官。

**产出**：
- **火山引擎 DNS 域名解析**：成功在火山引擎域名服务后台为 `jeffgame.tech` 添加 `A` 记录，将主机记录 `poker` 指向 GCP 公网 IP `34.92.181.190`，完成 DNS 解析秒级生效。
- `/var/www/poker-night/poker-night.nginx.conf` — 线上重构为极简、标准且没有指令冗余的生产级 Nginx 反向代理配置（精简了由 Certbot 重复插入的 `ssl_protocols` 和 `ssl_ciphers`，直接信任并继承 `/etc/letsencrypt/options-ssl-nginx.conf` 的最佳实践，完全消除了 Nginx 启动自检的 duplicate warnings/emerg 报错）。
- **SSL 证书部署**：通过 Certbot 全自动为 `poker.jeffgame.tech` 申请并绑定 Let's Encrypt 证书，自动配置 `80 -> 443` 的 301 强转跳转规则。

**关键决策与排障记录**：
- **Nginx & Certbot 经典“鸡生蛋，蛋生鸡”报错排障**：由于初始模板配置中开启了 `listen 443 ssl` 但证书尚未生成，Nginx 会因缺少 `ssl_certificate` 导致自检失败而拒绝启动，进而阻止 Certbot 进行网络验证。通过**临时剔除 ssl 标志**，让 Nginx 顺利过检并监听 443 端口，在 Certbot 生成并写入证书后再行补全，完美解开了此闭环锁。
- **Nginx + Certbot 规则重复导致的无限重定向循环（Too Many Redirects）排障**：由于 Certbot 在生成 443 配置时发生误判，将 SSL 证书挂载到了原本专用于 HTTP 跳转的 server 块上，而把实际转发 3000 端口游戏服务的 server 块置于了未加密的 443 监听下，导致 HTTPS 访问被不断重定向至自身。通过**重写标准生产级 Nginx 双 Server 块配置**彻底根治了该问题。
- **默认 IP 404 安全加固**：通过移除 `/etc/nginx/sites-enabled/default`，使 Nginx 仅响应正确的域名请求。对于使用裸 IP 访问的请求直接返回 404。这极大提升了服务防扫描、防越权及防爆破的安全性，使游戏环境符合高水准的商业化专业规范。

**测试验证**：
- 浏览器通过域名 `https://poker.jeffgame.tech` 完美极速连入，地址栏带有安全锁标记。
- 控制台获取 `/api/me` 返回 `401`（未登录）为完全正常的初始化路由机制，登录/注册后即转为 200 OK。
- 外部 BGM 加载失败时自动触发前端 built-in Web Audio API 降级算法，本地实时合成 Lo-Fi 爵士乐，对局长连接状态及游戏逻辑 100% 健全流畅！
- **V1 完美收官声明**：至此，德州扑克核心规则、账号持久筹码、战绩历史落库、长超时 WebSocket 防断线重连、明牌管理后台与全套谷歌云香港生产运维、域名 SSL 加密全部落地通关。V1 版本功德圆满，宣布正式收官！

---

## Step 12 — V2 Phase 1：十人桌扩容与移动端竖屏适配（2026-05-25，待提交）

**目标**：进入 V2 第一阶段（高优先级需求 1/2/3）。将牌桌从 6 物理座位扩容为最多 10 人入座，并为手机浏览器竖屏新增专用布局，依屏幕方向自动切换横/竖屏模式。

**产出**：
- `server/config.js` — 新增 `MAX_SEATS: 10`、`MAX_ONLINE: 10` 两个容量常量，集中管理单桌规模。
- `server/table.js` — 座位数组改为 `Array(config.MAX_SEATS)`；房间在线上限改用 `config.MAX_ONLINE`；庄家顺时针轮换循环由写死的 `i<=6 / %6` 改为基于 `this.seats.length`。
- `server/table.js#translateToRelative` — 视角相对座位旋转的取模基数由写死的 `6` 参数化为 `this.seats.length`（=10），使 10 座下每个玩家仍恒在自己屏幕底部、对手顺时针环绕。顺带修复一处既存 bug：`isDealer` 此前用绝对座位与「已被旋转过」的 `dealerSeat` 比较，现改为在旋转前捕获 `absDealer` 再比较。
- `public/index.html` — 新增 `#seat-6`~`#seat-9` 四个对手席位 DOM（共 9 对手位 + 英雄区）。
- `public/style.css` — 重排 `#seat-1`~`#seat-9` 为 10-handed 椭圆环绕坐标；新增 `body.portrait` 竖屏专用布局块（相对尺寸牌桌、窄屏座位坐标、操作区吸附视口底部并加大触控热区、隐藏底部规则区与侧栏、英雄区去除 translateX 变换以让固定操作条正确吸底）。
- `public/js/app.js` — 新增 `App.MAX_SEATS=10` 常量；空座清理循环由 `1..5` 改为 `1..MAX_SEATS-1`；大厅人数分母 `/6` 改为 `/MAX_SEATS`；新增 `_setupOrientation()`，用 `matchMedia('(orientation: portrait)')` 监听屏幕方向，实时为 `<body>` 切换 `.portrait`/`.landscape`（满足需求 3 自动检测）。

**关键决策与发现**：
- **服务端早已具备视角相对旋转**（集中在 `table.js#translateToRelative`，由 `sendToSocket`/`broadcast` 自动套用），并非如初判存在「非 0 号位玩家英雄区显示错」的多人 bug。Phase 1B 实际工作因此从「新增旋转」收敛为「把旋转的取模基数参数化为 10」，改动更小、风险更低。
- 相对旋转保留环形几何：`relative = (abs - viewer + N) % N`，空座以「空座」占位呈现（沿用既有渲染）。
- 移动端按**屏幕方向**切换（非设备类型）：手机竖放→竖屏 UI，横放/桌面→沿用现有布局。

**测试验证**：
- 单元测试（hand-rank / pot 等）全绿；三个 E2E 脚本（step6 对局流、step7 历史、offline 通知）在 `PORT=3010` 独立运行**各自全部通过**（`npm test` 一把跑会因三脚本同时抢占单桌单例 Table 而互相干扰，属既有限制，非本次回归）。
- 浏览器预览：登录进入牌局后，桌面横屏（1280×800）下 9 个对手席位沿椭圆均匀环绕、英雄区居底、均在视口内无裁切；手机竖屏（375×812）下 `body.portrait` 生效，9 席位收于窄屏宽度内、操作条吸附视口底部（650–812）且与英雄区无重叠、页面恰好占满一屏不溢出。无控制台报错。

---

## Step 13 — V2 Phase 2：后台密码登录 + 注册玩家查阅 + 实时游戏中玩家列表（2026-05-25，待提交）

**目标**：补齐管理后台运营能力（中优先级需求 4/5 + 需求 8 的鉴权前置）。给零鉴权的 `/admin` 加密码登录门，新增全服注册玩家查阅与详情，并在后台旁观列表上方新增「实时游戏中玩家」面板。

**产出**：
- `server/config.js` + `.env.example` — 新增 `ADMIN_PASSWORD`（默认 `admin888`，生产用环境变量覆盖）。
- `server/admin-routes.js`（新增）— 管理后台 HTTP 路由 + `requireAdmin` 中间件：`POST /login`（校验密码后置 `session.isAdmin`）、`POST /logout`、`GET /me`、`GET /players`（全服玩家）、`GET /player/:id`（玩家详情+最近 50 手历史）、`POST /kick`（从 index.js 迁入并加鉴权）。登录一次后操作免密。
- `server/index.js` — 挂载 `/api/admin` 路由（先于通用 `/api`），移除原零鉴权的内联 kick 路由。
- `server/admin-socket.js` — `/admin` 命名空间新增鉴权中间件，仅 `session.isAdmin` 的连接可接入实时通道。
- `server/table.js` — 入座/旁观/补位时记录 `connectedAt`；`getAdminState` 的 onlinePlayers 增加 `userId`/`connectedAt`，spectators 增加 `userId`/`connectedAt`，供后台统计在线时长。
- `public/admin.html` —
  - 登录蒙层（默认显示，`/api/admin/me` 鉴权通过才连 socket + 拉玩家列表）、头部「退出登录」按钮、socket `connect_error` 回退登录。
  - 「全服注册玩家」面板（表格：ID/用户名/筹码/终生净收益/注册时间，点击行弹详情 modal，含统计与近期对局）。
  - 「实时游戏中玩家」面板置于旁观列表上方（在线状态点/ID/座位/在线时长秒级刷新/筹码）。
  - 迷你明牌监控板由 6 座扩为 10 座（新增 `seat-abs-6~9` DOM + 坐标，渲染循环与「席位入座 X/10」同步）。

**关键决策**：
- 鉴权模型：单一管理员密码，登录一次在 cookie-session 置 `isAdmin`，后续 HTTP 路由与 socket 命名空间共用 `requireAdmin` 口径，操作免密（按用户要求）。
- 「在线时长」= 取座/入列时的 `connectedAt` 到当前；前端 1 秒定时器本地推算并刷新，离线托管期间仍计时、状态另以圆点标识。

**测试验证**：
- 后台登录：错误密码被拒并提示；正确密码进入、socket 连上、注册玩家表加载（开发库 22 条）。未登录时不建立 socket（鉴权门生效）。
- 注册玩家详情：点开玩家弹窗正确显示筹码/终生收益/近期手牌（后端 `/api/admin/player/:id` 正常）。
- 实时游戏中玩家：样本数据校验在线/离线、ID、座位、时长（3分5秒 / 1时2分）、筹码均正确渲染；迷你监控板 10 座全部落在场景内。
- 回归：三个 E2E（step6 对局流 / step7 历史 / offline 通知）对运行中的服务 `PORT=3000` 独立运行**全部通过**（exit 0），管理后台路由重构与 `getAdminState` 改动无回归。

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
| 7 | `GET /api/history` + 前端 `_loadHistory` 接真实数据 | ✅ commit `3a39b86` |
| 8 | 客户端视觉美化、高保真音效、粒子弹力反馈与离线自动托管机制优化 | ✅ commit `60c3fe8` |
| 9 | 独立实时明牌管理后台与控制台实时日志终端 | ✅ commit `75ceac8` |
| 9.1 | 客户端规则常驻/滚动提示/回合高亮/行动飘字 & 管理员实时筹码Buyin与全局弹窗广播 | ✅ commit `4e73676` |
| 9.2 | 牌型规则卡牌化展开、结算赢家底牌物化、HUD悬浮重构与高DPI字号放大 | ✅ commit `083389b` |
| 9.3 | 牌局显示和交互优化需求（字号加大、位置 badges 样式、手牌 Show/Muck、5+2 结算动画） + 致命 JavaScript crash Bug 修复 | ✅ commit `8986e8a` |
| 9.4 | 核心游戏引擎致命漏洞修复、皇家同花顺强化与 Option A 高级扑克规则集成 | ✅ commit `5d31204` |
| 9.5 | 多 Agent Git 分支与 worktree 协作体系 | ✅ commit 本次提交 |
| 9.6 | GitHub 远端仓库初始化与 GitHub CLI 配置 | ✅ commit 本次提交 |
| 9.7 | 玩家离线/重连全局强通知弹窗（补齐 Step 8 遗留） | ✅ commit 本次提交 |
| 9.8 | 未来前端与后端架构路线文档 `FutureRoadmap.md` | ✅ commit 本次提交 |
| 10 | 谷歌云香港 VM 部署（PM2 守护、Nginx WebSocket 反代、安全组配置、部署指南） | ✅ commit 本次提交 |
| 11 | 专属域名绑定、HTTPS 证书配置与 WebSocket 安全升级（V1 终结宣告） | ✅ commit 本次提交 |

---

## 给下一次会话的提示

1. 先读本文件 → 知道做到哪步
2. 再读 `CLAUDE.md` / `AGENTS.md` → 知道项目规范、前端结构约定和 Git 分支/worktree 协作策略
3. `git log --oneline` 看最新进度
4. 如果"上一步在做什么"和 HISTORY.md 不一致，**以代码和 git log 为准**，并更新本文件
5. 多 agent 开发时，不要共用 `F:/antigravityProject` 工作目录；Codex / Claude / Antigravity 分别使用自己的 worktree
