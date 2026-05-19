/**
 * 大厅模块（V1 单桌）
 *
 * 维护当前已连接的玩家列表，并向所有 socket 广播 lobby_state。
 *
 * 推送事件：
 *   lobby_state  { players: [{ username, chips }], count: number }
 *
 * 设计要点：
 * - 一个用户开多个标签页会有多个 socket；按 userId 去重，只算一人
 * - 不在这里处理"落座/弃牌/下注"——那是 step 5/6 游戏引擎的事
 * - 不在这里检查最大人数——V1 单桌容量 6，由后续逻辑约束
 */
const db = require('./db');

const findById = db.prepare('SELECT id, username, chips FROM users WHERE id = ?');

/** socket.id → { userId, username, chips } */
const sockets = new Map();

function buildLobbyState() {
  // 按 userId 去重
  const seen = new Map();
  for (const info of sockets.values()) {
    if (!seen.has(info.userId)) {
      seen.set(info.userId, { username: info.username, chips: info.chips });
    }
  }
  const players = Array.from(seen.values());
  return { players, count: players.length };
}

/**
 * 把大厅逻辑挂到 Socket.IO 实例上。
 * 调用前必须先用 `io.engine.use(sessionMiddleware)` 让握手请求带上 session。
 */
function attach(io) {
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
    sockets.set(socket.id, { userId: u.id, username: u.username, chips: u.chips });
    console.log(`[Lobby] + ${u.username} (${socket.id}) — 当前 ${sockets.size} 个 socket`);

    io.emit('lobby_state', buildLobbyState());

    socket.on('disconnect', () => {
      sockets.delete(socket.id);
      console.log(`[Lobby] - ${u.username} (${socket.id}) — 当前 ${sockets.size} 个 socket`);
      io.emit('lobby_state', buildLobbyState());
    });
  });
}

module.exports = { attach, buildLobbyState };
