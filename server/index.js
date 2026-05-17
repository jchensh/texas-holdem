/**
 * Poker Night 服务端入口
 *
 * - Express 提供 HTTP API 与静态文件托管
 * - cookie-session 用 HMAC 签名 cookie 保存 userId
 * - Socket.IO 留待 step 6 接入
 */
const path          = require('path');
const express       = require('express');
const cookieSession = require('cookie-session');

const config = require('./config');
const auth   = require('./auth');

const app = express();

// Railway 等反代会终止 SSL，需信任 X-Forwarded-Proto 才能让 secure cookie 工作
if (config.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(cookieSession({
  name:     'poker_session',
  keys:     [config.SESSION_SECRET],
  maxAge:   config.SESSION_MAX_AGE_MS,
  httpOnly: true,
  sameSite: 'lax',
  secure:   config.NODE_ENV === 'production',
}));

// 业务路由
app.use('/api', auth.router);

// 前端静态文件（最后挂，让 /api 路由优先匹配）
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA 默认页
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(config.PORT, () => {
  console.log(`[Poker Night] 已启动 → http://localhost:${config.PORT}  (${config.NODE_ENV})`);
});
