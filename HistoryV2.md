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
| **Phase 3（低优先级）** | 需求 6/7/8：音乐库、换头像、GM（加减筹码 / 踢人 / 删除玩家） | ⏳ 未开始 |

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

## 提交记录（V2，基线 main `ace6494`）

- `f6f9942` feat: V2 Phase 1 - 十人桌扩容与移动端竖屏自适应
- `c19d7dc` feat: V2 Phase 2 - 后台密码登录、注册玩家查阅与实时游戏中玩家列表
- `5abada9` fix: 移动端竖屏布局真机整改（英雄区遮挡/公共牌压座/结算弹窗跑偏/牌型徽标飘屏外）

## 待办（Phase 3，低优先级）

- 需求 6：音乐库——固定目录 `public/audio/` 手动放 mp3，后端扫描生成播放列表，客户端静音/下一首，移除旧爵士 CDN。
- 需求 7：换头像——先建 `public/avatars/` 与 20 个占位 PNG（约定 256×256、命名 `avatar-01.png`…），users 表加 `avatar` 列，注册与游戏内可选。
- 需求 8：GM 功能——后台整合加/减筹码、踢人，新增删除玩家（含级联 hand_history）。
