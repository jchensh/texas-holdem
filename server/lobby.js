/**
 * 大厅模块（V1 单桌）
 *
 * 在 Step 6 中，此模块作为 Socket.IO 的网关层：
 * 1. 在 `io.use()` 握手阶段，对 Socket 进行鉴权，将 `socket.data.user` 存好。
 * 2. 在连接成功后，将 Socket 连接托管给全局的 `table` 单例。
 */
const db = require('./db');
const table = require('./table');

const findById = db.prepare('SELECT id, username, chips FROM users WHERE id = ?');

function attach(io) {
  // 注入 io 实例给 table
  table.attach(io);

  // 握手鉴权：拒绝未登录的连接
  io.use((socket, next) => {
    const session = socket.request.session;
    if (!session || !session.userId) {
      return next(new Error('未登录'));
    }
    const user = findById.get(session.userId);
    if (!user) {
      return next(new Error('会话已失效'));
    }
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const u = socket.data.user;

    // 托管给 table 分配座位/绑定
    table.sitPlayer(u, socket);

    // 监听玩家的具体 Action 操作
    socket.on('action', (action) => {
      table.handlePlayerAction(socket, action);
    });

    // 结算亮牌请求
    socket.on('show_hand', () => {
      table.handleShowHand(socket);
    });

    // 监听断开连接
    socket.on('disconnect', () => {
      table.handleDisconnect(socket);
    });
  });
}

// 导出 attach 及代理旧接口，确保向下兼容
module.exports = {
  attach,
  buildLobbyState: () => {
    const seen = new Map();
    table.seats.forEach(seat => {
      if (seat && !seen.has(seat.userId)) {
        seen.set(seat.userId, { username: seat.username, chips: seat.chips });
      }
    });
    table.spectators.forEach(spec => {
      if (!seen.has(spec.userId)) {
        seen.set(spec.userId, { username: spec.username, chips: spec.chips });
      }
    });
    const players = Array.from(seen.values());
    return { players, count: players.length };
  }
};
