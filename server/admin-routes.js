/**
 * 管理后台 HTTP 路由（挂载在 /api/admin 下）
 *
 * 鉴权模型：登录时校验一次密码，成功后在 cookie-session 内置 isAdmin 标记；
 * 之后所有管理操作只校验 session.isAdmin，不再要求重复输入密码。
 *
 * 导出 requireAdmin 中间件，供 HTTP 路由与 Socket.IO /admin 命名空间共用同一鉴权口径。
 */
const express = require('express');
const config  = require('./config');
const db      = require('./db');

const router = express.Router();

/** Express 中间件：需要管理员登录态 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ message: '需要管理员登录' });
  }
  next();
}

// ── 鉴权 ────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== config.ADMIN_PASSWORD) {
    return res.status(401).json({ message: '管理员密码错误' });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  if (req.session) req.session.isAdmin = false;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ── 玩家管理（均需管理员） ────────────────────────────────
const listAllUsersStmt = db.prepare(
  'SELECT id, username, chips, lifetime_profit, created_at FROM users ORDER BY id ASC'
);
const getUserStmt = db.prepare(
  'SELECT id, username, chips, lifetime_profit, created_at FROM users WHERE id = ?'
);
const getUserHistoryStmt = db.prepare(`
  SELECT hand_id, ended_at, result, profit, chips_after
  FROM hand_history
  WHERE user_id = ?
  ORDER BY ended_at DESC
  LIMIT 50
`);

router.get('/players', requireAdmin, (_req, res) => {
  res.json({ players: listAllUsersStmt.all() });
});

router.get('/player/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const player = getUserStmt.get(id);
  if (!player) return res.status(404).json({ message: '玩家不存在' });
  res.json({ player, history: getUserHistoryStmt.all(id) });
});

// ── 踢人（由 admin.html 走 socket，这里保留 HTTP 入口并加鉴权） ──
router.post('/kick', requireAdmin, (req, res) => {
  const { username } = req.body || {};
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

module.exports = { router, requireAdmin };
