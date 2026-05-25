/**
 * 需求8(GM) 删除玩家级联清理的单元测试。
 *
 * 重点守护一个易踩的坑：hand_history 外键没声明 ON DELETE CASCADE，
 * 且 foreign_keys=ON 时，直接删 users 会被外键拦住。正确做法是
 * 「先删该用户的手牌历史，再删用户」并包成事务。
 *
 * 用 :memory: 库复刻 schema 独立验证，不触碰真实开发库。
 */
const test     = require('node:test');
const assert   = require('node:assert');
const Database = require('better-sqlite3');

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      chips INTEGER DEFAULT 1000
    );
    CREATE TABLE hand_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      hand_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  return db;
}

// 复刻 db.js 里的 deleteUserCascade 事务逻辑
function makeCascade(db) {
  return db.transaction((userId) => {
    const removedHands = db.prepare('DELETE FROM hand_history WHERE user_id = ?').run(userId).changes;
    const removedUser  = db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes;
    return { removedHands, removedUser };
  });
}

test('开启外键约束时，直接删用户（仍有手牌历史）会被外键拦截', () => {
  const db = setupDb();
  const uid = db.prepare('INSERT INTO users (username) VALUES (?)').run('alice').lastInsertRowid;
  db.prepare('INSERT INTO hand_history (user_id, hand_id) VALUES (?, ?)').run(uid, 'h1');
  assert.throws(() => db.prepare('DELETE FROM users WHERE id = ?').run(uid), /FOREIGN KEY/);
  db.close();
});

test('级联事务：先删手牌历史再删用户，完整删除且不留孤儿记录', () => {
  const db = setupDb();
  const uid = db.prepare('INSERT INTO users (username) VALUES (?)').run('bob').lastInsertRowid;
  db.prepare('INSERT INTO hand_history (user_id, hand_id) VALUES (?, ?)').run(uid, 'h1');
  db.prepare('INSERT INTO hand_history (user_id, hand_id) VALUES (?, ?)').run(uid, 'h2');

  const result = makeCascade(db)(uid);
  assert.strictEqual(result.removedHands, 2);
  assert.strictEqual(result.removedUser, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM users').get().c, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM hand_history').get().c, 0);
  db.close();
});

test('删除某玩家不影响其他玩家的账号与历史', () => {
  const db = setupDb();
  const a = db.prepare('INSERT INTO users (username) VALUES (?)').run('a').lastInsertRowid;
  const b = db.prepare('INSERT INTO users (username) VALUES (?)').run('b').lastInsertRowid;
  db.prepare('INSERT INTO hand_history (user_id, hand_id) VALUES (?, ?)').run(a, 'ha');
  db.prepare('INSERT INTO hand_history (user_id, hand_id) VALUES (?, ?)').run(b, 'hb');

  makeCascade(db)(a);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM hand_history WHERE user_id = ?').get(b).c, 1);
  db.close();
});

test('删除没有任何手牌历史的玩家也能正常工作', () => {
  const db = setupDb();
  const uid = db.prepare('INSERT INTO users (username) VALUES (?)').run('newbie').lastInsertRowid;
  const result = makeCascade(db)(uid);
  assert.strictEqual(result.removedHands, 0);
  assert.strictEqual(result.removedUser, 1);
  db.close();
});
