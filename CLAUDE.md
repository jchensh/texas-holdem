# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Poker Night

Texas Hold'em 网页扑克游戏，供朋友间在线联机娱乐使用。

## 技术栈

- **后端**：Node.js + Express + Socket.IO
- **数据库**：SQLite（via better-sqlite3）
- **前端**：原生 HTML/CSS/JS（无框架，无构建步骤）
- **认证**：bcrypt + cookie session
- **部署**：Railway

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
