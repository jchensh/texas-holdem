/**
 * Poker Night 服务端入口
 *
 * - Express 提供 HTTP API 与静态文件托管
 * - cookie-session 用 HMAC 签名 cookie 保存 userId
 * - Socket.IO 复用同一份 cookie-session 中间件，握手时即可拿到 req.session.userId
 */
const http          = require('http');
const path          = require('path');
const express       = require('express');
const cookieSession = require('cookie-session');
const { Server: SocketIOServer } = require('socket.io');

const config = require('./config');
const auth   = require('./auth');
const lobby  = require('./lobby');

const app    = express();
const server = http.createServer(app);

// Railway 等反代会终止 SSL，需信任 X-Forwarded-Proto 才能让 secure cookie 工作
if (config.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// 提取中间件实例，Express 和 Socket.IO engine 都要用同一个
const sessionMiddleware = cookieSession({
  name:     'poker_session',
  keys:     [config.SESSION_SECRET],
  maxAge:   config.SESSION_MAX_AGE_MS,
  httpOnly: true,
  sameSite: 'lax',
  secure:   false, // 允许 HTTP 下传输 cookie（支持直接公网 IP 访问测试）
});

app.use(express.json());
app.use(sessionMiddleware);

// 业务路由
app.use('/api', auth.router);

// 管理员踢人临时 API
app.post('/api/admin/kick', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ message: '请输入要踢出的用户名' });
  }
  const table = require('./table');
  const success = table.kickPlayer(username);
  if (success) {
    res.json({ ok: true, message: `已成功将玩家 ${username} 踢出` });
  } else {
    res.status(404).json({ message: `未找到玩家 ${username}` });
  }
});

// 前端静态文件（最后挂，让 /api 路由优先匹配）
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA 默认页
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

// Socket.IO — 复用 cookie-session 中间件，握手请求也能读到 req.session
const io = new SocketIOServer(server);
io.engine.use(sessionMiddleware);
lobby.attach(io);

// 挂载管理员专属数据通道
const adminSocket = require('./admin-socket');
adminSocket.init(io);

server.listen(config.PORT, () => {
  console.log(`[Poker Night] 已启动 → http://localhost:${config.PORT}  (${config.NODE_ENV})`);
});
