# Poker Night V2 开发历史

> V1 已正式发布（见 `HISTORY.md` Step 1–11，main `ace6494`）。本文件记录 V2 阶段的改动。
> 新会话恢复上下文时：先读 `HISTORY.md` 与本文件，再看 `git log --oneline`。

## V2 总览

V2 目标：把「6 人单机感」的牌桌升级为最多 **10 人、可手机竖屏游玩**的产品，并补齐管理后台运营能力（玩家查阅 / 实时监控 / GM），以及音乐库与头像两项体验功能。

按优先级分阶段交付：

| 阶段 | 范围 | 状态 |
|------|------|------|
| **Phase 1（高优先级）** | 需求 1/2/3：十人桌扩容、服务端视角相对旋转参数化、移动端竖屏专用布局 + 按方向自动切换 | ✅ 已完成（commit `f6f9942` + 真机整改 `5abada9`） |
| **Phase 2（中优先级）** | 需求 4/5 + 需求 8 鉴权前置：后台密码登录、全服注册玩家查阅、实时游戏中玩家列表 | ✅ 已完成（commit `c19d7dc`） |
| **Phase 3（低优先级）** | 需求 6/7/8：音乐库、换头像、GM（加减筹码 / 踢人 / 删除玩家） | 🚧 进行中（需求 6 ✅ `3c1ef31`、需求 8 ✅；需求 7 待开发） |

---

## Phase 1 — 十人桌扩容 + 移动端竖屏（commit `f6f9942`，真机整改 `5abada9`）

### 关键决策
1. 扩成真正的 10 人桌（9 对手 + 英雄），全部可入座下注。
2. 手机竖屏做**专用重排布局**，按**屏幕方向**自动切换（竖屏→竖屏 UI，横屏/桌面→现有布局）。
3. 服务端**视角相对座位旋转早已存在**（集中在 `table.js#translateToRelative`，由 `sendToSocket`/`broadcast` 自动套用）——并非初判的「多人英雄区 bug」。实际工作是把旋转的取模基数从写死的 `6` 参数化为座位数 `10`。

### 后端改动
- `server/config.js`：新增 `MAX_SEATS: 10`、`MAX_ONLINE: 10`。
- `server/table.js`：
  - 座位数组 `Array(6)` → `Array(config.MAX_SEATS)`。
  - 房间在线上限 `>= 10` → `>= config.MAX_ONLINE`。
  - 庄家顺时针轮换 `for i<=6 / %6` → 基于 `this.seats.length`。
  - `translateToRelative` 内 6 处 `(abs - viewer + 6) % 6` → `% N`（`N = this.seats.length`）。
  - 顺带修复既存 bug：`isDealer` 之前用绝对座位与「已被旋转过」的 `dealerSeat` 比较，改为旋转前捕获 `absDealer` 再比较。
- 引擎 `engine/game.js` 的盲注/行动逻辑基于「已入座玩家子集」，与固定座位数无耦合，无需改动。

### 前端改动
- `public/index.html`：新增 `#seat-6`~`#seat-9`（共 9 对手位 + 英雄区 `#seat-0`）。
- `public/style.css`：重排 `#seat-1`~`#seat-9` 为 10-handed 椭圆环绕坐标；新增 `body.portrait` 竖屏专用布局块。
- `public/js/app.js`：新增 `App.MAX_SEATS=10`；空座清理循环 `1..5` → `1..MAX_SEATS-1`；大厅人数分母 `/6` → `/MAX_SEATS`；新增 `_setupOrientation()`，用 `matchMedia('(orientation: portrait)')` 监听屏幕方向，实时为 `<body>` 切换 `.portrait`/`.landscape`。

### 真机整改（`5abada9`）——竖屏布局修复
Phase 1 竖屏首版在真机暴露遮挡/错位，集中整改 `body.portrait`：
- **英雄区被遮挡**：旧方案操作条单独 `fixed` 吸底、英雄底牌留在牌桌底部被盖。改为把**整个 `.hero-zone`（牌型徽标 + 底牌 + 信息 + 操作面板）作为一组固定到视口底部**，`flex-wrap` 让操作面板换到独立整行，底牌/信息在其上方，杜绝遮挡。
- **公共牌压座位**：竖屏公共牌缩为 40×56（含牌面字号），座位/椭圆坐标重排，9 座环绕不再与公共牌重叠。
- **结算弹窗跑偏**：`.settlement-overlay` 基础样式带 `translate(-50%,-50%)`，之前竖屏只改 `inset:0` 未清 transform → 被推出屏外。改为全视口 `flex` 居中 + `transform:none`。
- **牌型徽标飘屏外**：`.hand-type-badge` 的 `animation: badgeFadeIn ... forwards` 结束后保留 `translate(-50%)`，覆盖 `transform:none`。竖屏追加 `animation:none` + `position:static`，徽标居中整行。
- 牌桌场景高度收为 54vh（上半屏），对手座位、底池、回合横幅字号同步压缩。

### 验证
- 单元测试全绿；三个 E2E（step6 对局流 / step7 历史 / offline 通知）独立运行各自全部通过（`npm test` 一把跑会因三脚本同抢单例 Table 互相干扰，属既有限制）。
- 横屏 1280×800：9 席沿椭圆均匀环绕、全在视口内无裁切。
- 竖屏 375×812（DOM 实测坐标）：英雄坞固定视口底部（552–812）、牌型徽标居中、底牌（598–666）在按钮（672–804）之上无重叠、公共牌落在椭圆内、结算弹窗水平居中。真机复测确认关键信息无遮挡。

---

## Phase 2 — 后台密码登录 + 注册玩家查阅 + 实时游戏中玩家列表（commit `c19d7dc`）

### 关键决策
- 鉴权模型：单一管理员密码，登录一次在 cookie-session 置 `isAdmin`，后续 HTTP 路由与 socket 命名空间共用 `requireAdmin` 口径，操作免密。
- 「在线时长」= 取座/入列时的 `connectedAt` 到当前；前端 1 秒定时器本地推算刷新，离线托管期间仍计时、状态另以圆点标识。
- 需求 5「实时游戏中玩家」列表放在管理后台旁观列表上方。

### 后端改动
- `server/config.js` + `.env.example`：新增 `ADMIN_PASSWORD`（默认 `admin888`，生产用环境变量覆盖）。
- `server/admin-routes.js`（新增）：管理后台 HTTP 路由 + `requireAdmin` 中间件——
  - `POST /api/admin/login`（校验密码后置 `session.isAdmin`）、`POST /logout`、`GET /me`。
  - `GET /players`（全服注册玩家）、`GET /player/:id`（玩家详情 + 最近 50 手历史）。
  - `POST /kick`（从 index.js 迁入并加鉴权）。
- `server/index.js`：挂载 `/api/admin` 路由（先于通用 `/api`），移除原零鉴权内联 kick 路由。
- `server/admin-socket.js`：`/admin` 命名空间新增鉴权中间件，仅 `session.isAdmin` 的连接可接入实时通道。
- `server/table.js`：入座/旁观/补位记录 `connectedAt`；`getAdminState` 的 onlinePlayers 增加 `userId`/`connectedAt`，spectators 增加 `userId`/`connectedAt`。

### 前端改动（`public/admin.html`）
- 登录蒙层（默认显示，`/api/admin/me` 鉴权通过才连 socket + 拉玩家列表）、头部「退出登录」按钮、socket `connect_error` 回退登录。
- 「全服注册玩家」面板（表格：ID/用户名/筹码/终生净收益/注册时间，点击行弹详情 modal，含统计与近期对局）。
- 「实时游戏中玩家」面板置于旁观列表上方（在线状态点 / ID / 座位 / 在线时长秒级刷新 / 筹码）。
- 迷你明牌监控板由 6 座扩为 10 座（新增 `seat-abs-6~9` + 坐标，渲染循环与「席位入座 X/10」同步）。

### 验证
- 后台登录：错误密码被拒并提示；正确密码进入、socket 连上、注册玩家表加载。未登录时不建立 socket。
- 玩家详情：弹窗正确显示筹码/终生收益/近期手牌。
- 实时游戏中玩家：在线/离线、ID、座位、时长、筹码渲染正确；迷你监控板 10 座全部落在场景内。
- 回归：三个 E2E 对运行中服务 `PORT=3000` 全部通过，后台路由重构与 `getAdminState` 改动无回归。

---

## Phase 3（需求 6）— 本地音乐库 + 多曲目切换（commit 待提交）

### 关键决策
- **本地曲库取代单一外链 CDN**：移除写死的 Mixkit 爵士乐外链（`app.js` 旧第 45 行），改为后端扫描 `public/audio/` 目录动态生成播放列表。mp3 文件提交进仓库，部署即带音乐。
- **保留 Web Audio 合成爵士乐做兜底**：当 `public/audio/` 为空或曲目加载失败时，自动降级到既有的 `_startProceduralJazz()` 实时合成，保证任何情况下都有背景音乐、体验不断档。
- **实时扫描、无需重启**：播放列表接口每次请求实时读目录，新增/删除 mp3 不必重启服务。
- **演示曲目说明**：当前 `public/audio/` 内为 3 首 SoundHelix 免版权占位演示曲（`demo-01~03.mp3`），仅供演示机制；可直接替换为任意 mp3（前端按文件名自动显示曲名）。

### 后端改动
- `server/music-routes.js`（新增）— `GET /api/music/playlist` 扫描 `public/audio/` 返回 mp3 列表 `[{ file, name, url }]`；扫描逻辑抽成纯函数 `listAudioFiles(dir)` 便于单测；无需登录即可访问（登录页也要能放）。
- `server/index.js` — 挂载 `/api/music` 路由（先于通用 `/api`）。
- `public/audio/`（新增目录）— 放入 3 首演示 mp3。
- `server/music-routes.test.js`（新增）— 5 个单元测试：只返回 mp3、按名排序、url 编码、空目录返回 `[]`、文件名美化。

### 前端改动
- `public/index.html` — 顶部按钮文案「🎷 爵士乐」改为「🎵 音乐」；新增「⏭ 下一首」按钮 `#btn-music-next` 与当前曲名标签 `#music-track`（仅有曲库且播放时显示）。
- `public/js/app.js` — `AudioEngine` 改造：
  - 移除写死的 CDN 外链；新增 `playlist` / `currentIndex` / `_errorStreak` 状态。
  - `init()` 改为创建空 `Audio()`、`_loadPlaylist()` 异步拉曲库、监听 `ended` 自动切下一首、监听 `error` 先尝试下一首再降级合成。
  - 新增 `_loadPlaylist()` / `playTrack(index)`（索引取模回绕）/ `nextTrack()` / `_updateMusicUI()`。
  - `setBGM(true)` 有曲库放本地曲、空库走合成兜底；绑定「下一首」按钮点击 → `nextTrack()`。

### 验证
- 单元测试：`node --test server/engine/*.test.js server/music-routes.test.js` → 58/58 通过（53 引擎 + 5 音乐，无回归）。
- 接口：`GET /api/music/playlist` 返回 200 与 3 首曲目；`/audio/demo-01.mp3` 静态托管返回 200 `audio/mpeg`。
- 浏览器（preview_eval）：曲库加载 3 首、`bgm.src` 无残留 CDN；开启音乐播放 demo-01；「下一首」依次 01→02→03→回绕 01，曲名标签同步刷新；临时清空曲库后开启 → 自动降级合成爵士乐且下一首按钮隐藏；控制台零报错。

---

## Phase 3（需求 8）— GM 管理功能：加/减筹码整合 + 删除玩家（commit 待提交）

### 关键决策
- **GM 操作整合进"注册玩家详情弹窗"**：在 `admin.html` 玩家详情弹窗内统一提供 加筹码 / 扣筹码 / 踢下线 / 删除玩家，可对任意注册玩家（不限是否在线）操作。
- **减筹码 floor 到 0**：`adjustPlayerChips` 改为 `Math.max(0, chips+amount)`，按实际生效增量同步座位/引擎/大厅，杜绝负筹码；加/扣文案分别区分。
- **删除玩家先踢后删、级联清历史**：`hand_history` 外键未声明 ON DELETE CASCADE 且 `foreign_keys=ON`，直接删 user 会被外键拦住；故先 kick 下线释放座位，再在原子事务里"先删手牌历史、再删用户"。
- **删除二次确认**：前端要求管理员手动输入目标用户名匹配后才发送删除指令，防误删。

### 后端改动
- `server/db.js` — 新增 `db.deleteUserCascade(userId)` 事务：先删该用户 hand_history、再删 users，返回删除条数。
- `server/table.js` —
  - `adjustPlayerChips`：支持负数、floor 到 0、按 effectiveDelta 同步座位/引擎/大厅，加扣文案与日志区分。
  - 新增 `deletePlayer(username)`：查库 → 先 kickPlayer 下线 → deleteUserCascade → 同步大厅与后台。
- `server/admin-socket.js` — `admin_adjust_chips` 放开负数（仅拒 0/非法）；新增 `admin_delete_player` 处理器，回 `admin_action_result`。

### 前端改动（`public/admin.html`）
- 玩家详情弹窗 `openPlayerDetail` 新增「⚙️ GM 操作」区：筹码输入框 + 加/扣按钮 + 踢下线 + 删除玩家；记录 `window.currentDetailPlayer`。
- 新增 `gmAdjust(sign)` / `gmKick()` / `gmDelete()` / `triggerDeletePlayer(username)`（输入用户名二次确认）。
- `admin_action_result` 处理 `delete_player`：成功后关闭弹窗并 `fetchPlayers()` 刷新；`adjust_chips` 成功后刷新玩家表并重载弹窗。

### 验证
- 单元测试：`node --test server/engine/*.test.js server/music-routes.test.js server/admin-delete.test.js` → 62/62 通过（含 4 项删除级联：外键拦截直删、级联事务、互不影响、无历史亦可删）。
- 浏览器（preview_eval，管理员登录后驱动真实 UI 函数）：扣 300（1000→700）✅、加 500（→1200）✅、扣 99999 floor 到 0 不为负 ✅；删除 `gmtest9` 从注册玩家表消失、玩家数 2→1、弹窗自动关闭 ✅；删除二次确认输入错误名不删、正确才删 ✅；控制台零报错。

---

## 提交记录（V2，基线 main `ace6494`）

- `f6f9942` feat: V2 Phase 1 - 十人桌扩容与移动端竖屏自适应
- `c19d7dc` feat: V2 Phase 2 - 后台密码登录、注册玩家查阅与实时游戏中玩家列表
- `5abada9` fix: 移动端竖屏布局真机整改（英雄区遮挡/公共牌压座/结算弹窗跑偏/牌型徽标飘屏外）

## 待办（Phase 3，低优先级）

- ~~需求 6：音乐库~~ ✅ 已完成（见上方 Phase 3 章节）。
- 需求 7：换头像——先建 `public/avatars/` 与 20 个占位 PNG（约定 256×256、命名 `avatar-01.png`…），users 表加 `avatar` 列，注册与游戏内可选。
- ~~需求 8：GM 功能~~ ✅ 已完成（见上方 Phase 3 章节）。
