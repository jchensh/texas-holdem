/**
 * 认证模块
 *
 * 提供：
 *   POST /api/register   注册并自动登录
 *   POST /api/login      登录
 *   POST /api/logout     登出
 *   GET  /api/me         返回当前用户（刷新页面恢复登录态用）
 *
 * 还导出 requireAuth 中间件，供 socket 握手时复用。
 */
const express = require('express');
const bcrypt  = require('bcrypt');
const db      = require('./db');
const config  = require('./config');

const BCRYPT_ROUNDS = 10;
// 用户名：3-16 位，字母/数字/下划线/中文
const USERNAME_RE = /^[a-zA-Z0-9_一-龥]{3,16}$/;
const PASSWORD_MIN = 6;

const queries = {
  findByUsername: db.prepare(
    'SELECT id, username, password_hash, chips FROM users WHERE username = ?'
  ),
  findById: db.prepare(
    'SELECT id, username, chips FROM users WHERE id = ?'
  ),
  insert: db.prepare(`
    INSERT INTO users (username, password_hash, chips, created_at)
    VALUES (?, ?, ?, ?)
  `),
};

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: '用户名和密码不能为空' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ message: '用户名需 3-16 位（字母 / 数字 / 下划线 / 中文）' });
  }
  if (password.length < PASSWORD_MIN) {
    return res.status(400).json({ message: `密码至少 ${PASSWORD_MIN} 位` });
  }

  if (queries.findByUsername.get(username)) {
    return res.status(409).json({ message: '用户名已被占用' });
  }

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { lastInsertRowid: id } = queries.insert.run(
      username, hash, config.STARTING_CHIPS, Date.now()
    );

    req.session.userId = id;
    res.json({ user: { id, username, chips: config.STARTING_CHIPS } });
  } catch (err) {
    console.error('[auth] register 失败:', err);
    res.status(500).json({ message: '注册失败，请稍后重试' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: '用户名和密码不能为空' });
  }

  const user = queries.findByUsername.get(username);
  // 用户不存在时也走一次 bcrypt.compare 防止用响应时间侧信道枚举用户名
  const hashForCompare = user ? user.password_hash
                              : '$2b$10$0000000000000000000000000000000000000000000000000000z';

  try {
    const ok = await bcrypt.compare(password, hashForCompare);
    if (!user || !ok) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }
    req.session.userId = user.id;
    res.json({ user: { id: user.id, username: user.username, chips: user.chips } });
  } catch (err) {
    console.error('[auth] login 失败:', err);
    res.status(500).json({ message: '登录失败，请稍后重试' });
  }
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: '未登录' });
  }
  const user = queries.findById.get(req.session.userId);
  if (!user) {
    req.session = null;  // 会话指向不存在的用户，清掉
    return res.status(401).json({ message: '会话已失效' });
  }
  res.json({ user });
});

/** Express 中间件：需要登录才能访问 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: '未登录' });
  }
  const user = queries.findById.get(req.session.userId);
  if (!user) {
    req.session = null;
    return res.status(401).json({ message: '会话已失效' });
  }
  req.user = user;
  next();
}

module.exports = { router, requireAuth };
