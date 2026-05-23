# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Poker Night

Texas Hold'em 网页扑克游戏，供朋友间在线联机娱乐使用。

**开发进度与历史**：每个 step 完成后追加到 `HISTORY.md`。新会话恢复上下文时**先读 `HISTORY.md`**，再看 `git log --oneline`。

## 技术栈

- **后端**：Node.js + Express + Socket.IO
- **数据库**：SQLite（via better-sqlite3）
- **前端**：原生 HTML/CSS/JS（无框架，无构建步骤）
- **认证**：bcrypt + cookie session
- **部署**：谷歌云香港 VM 实例 (GCP Compute Engine) + PM2 + Nginx 反向代理 (支持 WebSocket)

## V1 功能范围

- 核心德州扑克规则（2-6人，单桌）
- 账号系统 + 持久筹码
- 手牌历史记录

## V1 不做

- 聊天功能
- 多桌/大厅系统
- 动画效果

## 前端结构（public/）

```
public/
  index.html      # 单页应用，包含三个视图：#view-auth / #view-game / #view-history
  style.css       # 全部样式，使用 CSS 变量（:root），无预处理器
  js/
    socket.js     # SocketClient — Socket.IO 事件接口，所有 emit/on 均有占位注释
    app.js        # App — 状态管理与 UI 更新，视图切换，计时器，历史渲染
```

**视图切换**：给 `.view` 加/去 `.active` class（CSS `display:none` / `flex`）。

**数据流**：后端 → `SocketClient._bindEvents()` → `App.*` 更新函数 → DOM。  
`App.updateGameState(state)` 是主入口，接收完整 GameState 快照。

**牌桌布局**：`.table-scene`（900×530px，`position:relative`）内用 `position:absolute` 摆放 5 个对手席位（`#seat-1` ~ `#seat-5`）和椭圆牌桌（`.poker-table`）。英雄区（`#seat-0`，即本人）固定在底部中央。

**牌面渲染**：`App._cardInnerHTML({ rank, suit })` 生成卡牌内容；红色花色（♥♦）给 `.card` 加 `.red` class。

## 开发规范

- 所有代码注释和文档用中文
- 前端不引入任何构建工具或框架
- 保持文件结构简单清晰

## 本地开发

- **启动服务**：`npm start` 或 `node server/index.js`，默认 http://localhost:3000
- **数据库**：首次启动自动建 `data/poker.db`，schema 用 `IF NOT EXISTS` 幂等，无迁移系统
- **环境变量**：拷 `.env.example` 为 `.env`。dev 可全部缺省；**生产必须**设 `SESSION_SECRET`
- **⚠ 系统代理坑（重要）**：开发机配了系统级代理（`HTTP_PROXY=http://127.0.0.1:7897`，常见 Clash 端口），它会把 **localhost 请求也代理走**，导致 `curl` / `wget` / Node fetch / 任何走 libcurl 的工具直接收到代理返回的 **502 / 302**。在终端调试本地 server 前先设：
  ```
  export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
  ```
  或在 curl 上加 `--noproxy 'localhost,127.0.0.1'`（**引号必须加**，否则 shell 把 `*` 当通配展开）。
  浏览器、Node 程序内部（不走代理）均不受影响——只有命令行客户端有此问题。

## Git 分支与多 Agent 协作

本项目后续由 Codex、Claude Code、Antigravity 多个 coding agent 协作。**不要让多个 agent 同时在同一个 `F:\antigravityProject` 工作目录里开发**；一个 Git 工作目录同一时间只能 checkout 一个分支，共用目录会导致未提交变更互相覆盖。

### 固定分支

- `main`：稳定主干，保持可部署状态。
- `next`：集成分支。各 agent 的任务分支先合入这里，测试通过并经人工确认后再合入 `main`。
- `codex/work`：Codex 起步工作分支。
- `claude/work`：Claude Code 起步工作分支。
- `antigravity/work`：Antigravity 起步工作分支。

### 固定 worktree 目录

```
F:\antigravityProject              # main，主工作区，只做 review / merge / release
F:\antigravityProject-codex        # codex/work
F:\antigravityProject-claude       # claude/work
F:\antigravityProject-antigravity  # antigravity/work
```

正式开发任务建议从 `next` 再切短生命周期任务分支：

```
git switch next
git pull
git switch -c codex/<task-name>
```

分支命名约定：

- `codex/<task-name>`
- `claude/<task-name>`
- `antigravity/<task-name>`
- `hotfix/<task-name>`：线上紧急修复，从 `main` 拉，修完合回 `main` 并反合到 `next`。
- `release/vX.Y.Z`：需要冻结测试时从 `next` 拉。

### 合并流程

1. agent 在自己的 worktree/任务分支开发。
2. 开发完成后至少运行 `npm test`，涉及 socket/history 的任务再运行对应 E2E 脚本。
3. 人工 review 后将任务分支合入 `next`。
4. `next` 验收稳定后再合入 `main`。
5. 每个重要 step 合入后追加 `HISTORY.md`；多 agent 同时开发时，`HISTORY.md` 由最终合并者统一整理，避免文件尾部冲突。

### 环境与生成物边界

- 不提交 `.env`、真实 `SESSION_SECRET`、线上 SQLite 数据库、VM 上的 Nginx/PM2 实际配置。
- 可提交 `.env.example`、部署模板、部署文档。
- 线上特定差异优先用环境变量或部署配置表达，不用长期分叉分支保存。
- `GIT_HISTORY_CHANGELOG.md` 是 `npm run export-git` 生成的本地文档，不纳入版本控制。

## Codex 工作约定

### 目标驱动执行（Goal-Driven Execution）

每个 step 开始前，先把"算完成"定义成可执行的测试，让测试驱动实现：

1. 写测试 → 跑红（确认测试真的反映需求）
2. 实现代码 → 让测试由红转绿
3. 跑全量测试 → 确认没有 regression

把模糊任务（如"实现牌型判断"）转换为有验收标准的循环（"让这 9 个测试通过"），让 Codex 在明确的成功标准下自循环，减少对人工逐行 review 的依赖。
