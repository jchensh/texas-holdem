# FutureRoadmap

本文档整理 Poker Night 的中长期技术构想，用于记录当前讨论形成的方向判断。它不替代 `HISTORY.md`：`HISTORY.md` 记录已经完成的 step，本文件记录未来路线、架构取舍和后续重构优先级。

## 当前优先级

当前最重要、最靠前的目标仍然是完成 V1：把现有单桌德州扑克项目跑通部署上线。

V1 的核心不是继续扩大功能，而是确认这套已经成型的后端规则、Socket.IO 实时通信、SQLite 持久化、前端牌桌体验能够在谷歌云香港 VM 上稳定运行。后续所有前端架构升级、动画渲染层升级、React/PixiJS 引入，都应该排在 V1 部署验证之后。

V1 优先完成：

- 谷歌云香港 VM 部署。
- PM2 进程守护。
- Nginx 反向代理，并确认 WebSocket 升级正常。
- HTTPS / 域名 / 防火墙安全组配置。
- 生产环境 `SESSION_SECRET` 等环境变量配置。
- SQLite 数据目录与备份策略。
- 线上 smoke test：注册、登录、入桌、行动、结算、历史记录、断线重连。

## 路线总览

未来推荐分为四个阶段推进：

| 阶段 | 目标 | 前端策略 | 后端策略 |
|------|------|----------|----------|
| V1 | 部署上线，稳定可玩 | 保持现有原生 HTML/CSS/JS | 补部署、健康检查、日志、备份 |
| V1.5 | 治理当前前端复杂度 | 拆分 `app.js` / `style.css`，隔离状态、渲染、动画、音频 | 文档化 Socket 协议，引入事件序号 |
| V2 | 现代化前端应用壳 | Vite + React + TypeScript，DOM/React 负责 UI | 提供清晰 API、快照恢复、schema 校验 |
| V2.5+ | 游戏化牌桌体验 | PixiJS 作为牌桌 Canvas/WebGL 渲染层 | 输出动画友好的事件流与完整 timeline |

推荐的长期形态是：

```text
Node / Express / Socket.IO
  authoritative game state
  auth / history / admin / settlement

Browser App
  React or DOM shell
  login / history / admin / settings / HUD

Poker Table Renderer
  PixiJS canvas layer
  cards / chips / particles / seat effects
  consumes game_state snapshots and game_event timeline
```

核心原则：服务端永远是牌桌裁判和游戏真相来源，前端只负责展示、交互和动画演出。

## 前端长期方案：PixiJS + DOM/React

### DOM 是什么

DOM 是浏览器把 HTML 页面解析后生成的页面对象树。当前项目大量使用：

```js
document.getElementById('hero-chips').textContent = player.chips;
element.innerHTML = html;
element.classList.add('active');
```

这就是直接操作 DOM。

DOM 很适合按钮、表单、文字、弹窗、历史记录、布局结构。但当大量卡牌动画、筹码粒子、动态光效、复杂定时器都混在 DOM 操作里时，代码会越来越难维护。

### React 是什么

React 是用于构建用户界面的 JavaScript 库。它的价值不是“让动画更强”，而是把复杂 UI 拆成组件，并让 UI 随状态自动更新。

适合 React 承担的部分：

- 登录/注册。
- 牌局顶部信息。
- 操作按钮。
- 大厅蒙层。
- 结算弹窗。
- 手牌历史。
- 管理后台。
- 设置面板。
- 规则说明、排行榜、行动日志。

未来 React 层可以负责应用壳和信息型 UI：

```text
AppShell
  AuthView
  GameView
    Header
    Leaderboard
    ActionPanel
    SettlementModal
    LobbyOverlay
    PokerCanvasLayer
  HistoryView
  AdminView
```

### PixiJS 是什么

PixiJS 是高性能 2D 渲染引擎。它通常在网页里创建一个 `<canvas>`，用 WebGL / WebGPU / Canvas 2D 绘制精灵、粒子、滤镜和动画。

PixiJS 不替代 React，也不替代后端规则。它只负责把牌桌演得更顺、更像游戏。

适合 PixiJS 承担的部分：

- 牌桌背景。
- 扑克牌精灵。
- 发牌轨迹。
- 翻牌动画。
- 筹码飞行动画。
- 粒子、光效、胜利动效。
- 玩家座位高亮。
- All-in、showdown、皇家同花顺等大场面演出。

未来 PixiJS 层可以暴露类似接口：

```js
renderer.applyGameState(gameState);
renderer.playDealCards(cards);
renderer.playPlayerAction(actionEvent);
renderer.playChipFlyToWinner(winnerSeatId);
renderer.showRoyalFlushEffect(seatId);
```

React/DOM 更新信息，PixiJS 播放演出。

## 为什么不优先 Cocos / Godot

Cocos Creator 和 Godot 都能做游戏，但它们更适合完整游戏客户端或跨平台游戏工程。

Poker Night 当前是一个网页联机德州扑克项目，包含账号系统、历史记录、管理后台、Socket.IO、部署在普通 Web 服务上。它的 UI 有大量网页应用属性，不只是一个全屏游戏场景。

因此长期更推荐：

1. PixiJS + DOM/React：最贴合网页德扑，轻量、可渐进迁移。
2. Phaser + DOM/React：如果未来牌桌体验更接近完整 2D 游戏，可考虑。
3. Cocos Creator：适合未来想做独立游戏客户端或小游戏平台版本。
4. Godot Web：除非强烈依赖 Godot 生态，否则不作为 H5 主路线。

## 关键架构边界

### 服务端是唯一真相

所有规则判断都在服务端完成：

- 当前轮到谁。
- 行动是否合法。
- call / raise 金额是否合法。
- 谁赢。
- 如何分池。
- 筹码如何变化。
- 手牌历史如何落库。

前端不能自己决定游戏结果。PixiJS 也不能拥有规则真相。

标准流程应该是：

```text
玩家点击“加注”
React 按钮触发 socket.emit('action')
服务端校验是否合法
服务端更新状态并广播 game_event / game_state
React 更新 UI
PixiJS 播放对应动画
```

### 快照和事件分离

未来实时协议建议拆成两类：

```text
game_state
  完整快照，用于刷新、重连、纠偏

game_event
  增量事件，用于播放动画
```

示例：

```js
{
  type: 'player_action',
  handId: 'h_123',
  seq: 42,
  seatId: 2,
  action: 'raise',
  amount: 120,
  potAfter: 360
}
```

`game_state` 保证正确，`game_event` 保证动画有上下文。

### PixiJS 不直接管理业务 UI

默认边界：

- Canvas / PixiJS：牌桌、牌、筹码、粒子、光效。
- DOM / React：按钮、输入框、弹窗、文字 HUD、历史、后台。

不要把所有文字和按钮都塞进 canvas。这样会损失浏览器原生可访问性、布局能力、表单能力，也会让管理后台和历史记录变难做。

## 后端配套升级

长期前端升级会倒逼后端更清晰。后端不只是“能跑”，而要逐渐变成稳定的实时游戏服务。

### V1 配套

V1 阶段后端重点是生产可用：

- `GET /healthz` 健康检查。
- PM2 日志、错误日志路径。
- Nginx WebSocket 反代验证。
- 生产环境变量检查，尤其是 `SESSION_SECRET`。
- SQLite 数据文件位置、备份和恢复说明。
- 关键 E2E 冒烟脚本整理。

### V1.5 配套

前端拆模块时，后端应整理协议：

- 新增 `docs/socket-protocol.md`。
- 明确所有 socket emit/on 事件 payload。
- 所有服务端推送附带 `handId`。
- 动画事件附带递增 `seq`。
- 前端检测漏序/乱序时，以最新 `game_state` 纠偏。
- 所有 socket 输入做 schema 校验，不信任客户端传来的 seatId、username、amount。

### V2 配套

React + PixiJS 阶段，后端需要提供更干净的边界：

- `GET /api/table/state`：刷新或重连时拉当前桌状态。
- 统一错误码：`NOT_YOUR_TURN`、`INVALID_RAISE`、`INSUFFICIENT_CHIPS` 等。
- 管理员 socket 和玩家 socket 权限隔离。
- 更完整的 hand metadata：`handId`、button seat、street、action timeline、pots、winners。
- 用户会话恢复：刷新页面、重连、多 tab 都能回到正确座位。

### V2.5+ 配套

高级动画和复盘需要后端提供完整 timeline：

- `hand_started`
- `blind_posted`
- `hole_dealt`
- `action_taken`
- `street_revealed`
- `showdown_started`
- `pot_awarded`
- `hand_settled`

历史记录可升级为完整复盘数据：

- 每一步行动。
- 每条街下注状态。
- 主池/边池明细。
- 赢家最优 5 张牌。
- kicker 和牌型解释。
- 亮牌/盖牌记录。

## 推荐的后端目录形态

当前后端已经有 `server/engine`、`server/table.js`、`server/lobby.js` 等雏形。长期可以演进为：

```text
server/
  engine/          # 纯德州规则，不碰 socket/db
  table/           # 房间状态机、座位、计时器
  realtime/        # Socket.IO 网关和协议
  services/        # 结算、历史、用户、管理操作
  db/              # SQLite 查询与事务
  schemas/         # 输入输出校验
```

拆分优先级：

1. Socket 协议文档化。
2. 引入 `handId + seq`。
3. 拆 `server/table.js`，分离房间生命周期、socket 广播、引擎调用、结算入库。
4. 补 `GET /api/table/state`。
5. 历史记录升级为 timeline。

## 多桌长期方向

V1 仍然是单桌。多桌不要太早做。

等单桌稳定后，可以把 `Table` 单例升级为：

```text
TableManager
  tables: Map<tableId, Table>

Table
  seats
  spectators
  game
  timers
  broadcast()
```

对应能力：

- 房间列表。
- 创建房间。
- 加入/离开房间。
- Socket.IO room：`table:{tableId}`。
- 历史按 `tableId` / `handId` 查询。
- 不同盲注、买入、最大人数配置。

## 暂不做

在 V1 部署前，不建议做以下大动作：

- 不全量重写 React。
- 不引入 PixiJS 到主流程。
- 不上 Cocos / Godot。
- 不做多桌。
- 不做完整 replay 系统。
- 不做复杂资产管线。

当前项目已经有很高的功能完成度。下一步最值钱的是上线验证，而不是提前重构到理想形态。

## 一句话总结

Poker Night 的长期方向可以是：服务端做可信牌桌裁判，React/DOM 做网页应用壳，PixiJS 做高质量牌桌演出。先完成 V1 部署，再逐步把当前原生前端拆清楚，最后再迁移到 React + PixiJS 的混合架构。
