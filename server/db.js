/**
 * SQLite 数据库初始化
 *
 * - 自动确保 data/ 目录存在
 * - 启用 WAL 模式：写不阻塞读，适合长连接 + 频繁状态写入
 * - 启用外键约束：SQLite 默认关闭
 * - schema 使用 IF NOT EXISTS 自然幂等，无需独立迁移系统
 *
 * 各模块直接 require('./db') 拿到 db 实例后自行 prepare 查询。
 */
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');
const config   = require('./config');

const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT    UNIQUE NOT NULL,
    password_hash   TEXT    NOT NULL,
    chips           INTEGER NOT NULL DEFAULT 1000,
    lifetime_profit INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hand_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    hand_id         TEXT    NOT NULL,
    ended_at        INTEGER NOT NULL,
    result          TEXT    NOT NULL,          -- 'win' | 'loss' | 'push'
    profit          INTEGER NOT NULL,          -- 净盈亏（可负）
    chips_after     INTEGER NOT NULL,
    hole_cards      TEXT,                      -- JSON 字符串
    community_cards TEXT,                      -- JSON 字符串
    action_summary  TEXT,
    seat_id         INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_history_user
    ON hand_history(user_id, ended_at DESC);
`);

// 热升级：为存量数据库升级手牌历史表，添加 seat_id 字段
try {
  db.exec('ALTER TABLE hand_history ADD COLUMN seat_id INTEGER DEFAULT 0');
  console.log('[db] 成功升级 hand_history 表，添加 seat_id 字段');
} catch (err) {
  // 忽略列已存在的错误
}

// ── Step 6: 筹码更新与手牌历史持久化事务 ───────────────────
const updateChipsStmt = db.prepare('UPDATE users SET chips = ?, lifetime_profit = lifetime_profit + ? WHERE id = ?');
const insertHistoryStmt = db.prepare(`
  INSERT INTO hand_history (user_id, hand_id, ended_at, result, profit, chips_after, hole_cards, community_cards, action_summary, seat_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.saveHandResults = db.transaction((handId, endedAt, players, actionLog, communityCards) => {
  for (const p of players) {
    updateChipsStmt.run(p.chipsAfter, p.profit, p.id);
    insertHistoryStmt.run(
      p.id,
      handId,
      endedAt,
      p.result, // 'win' | 'loss' | 'push'
      p.profit,
      p.chipsAfter,
      JSON.stringify(p.holeCards),
      JSON.stringify(communityCards),
      JSON.stringify(actionLog),
      p.seatId
    );
  }
});

// ── 需求8(GM)：删除玩家级联清理 ───────────────────────────
// hand_history 的外键未声明 ON DELETE CASCADE，且 foreign_keys=ON，
// 直接删 users 会被外键拦住，所以必须「先删该用户的手牌历史，再删用户」，并包成原子事务。
const deleteHistoryByUserStmt = db.prepare('DELETE FROM hand_history WHERE user_id = ?');
const deleteUserStmt          = db.prepare('DELETE FROM users WHERE id = ?');

db.deleteUserCascade = db.transaction((userId) => {
  const removedHands = deleteHistoryByUserStmt.run(userId).changes;
  const removedUser  = deleteUserStmt.run(userId).changes;
  return { removedHands, removedUser };
});

module.exports = db;


