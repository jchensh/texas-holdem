/**
 * Step 7 端到端手牌历史接口与分析器集成测试
 *
 * 用法：确保 server 运行在 PORT=3010，然后执行：
 *   node scripts/test-step7-history.js
 */
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');

const PORT = process.env.PORT || 3010;

// 连接真实的数据库以进行数据插入和验证
const dbPath = path.join(__dirname, '..', 'data', 'poker.db');
const db = new Database(dbPath);

// --- HTTP 辅助（不走系统代理） ---
function request(method, urlPath, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: 'localhost', port: PORT, path: urlPath, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        let parsed = null;
        try {
          if (raw) parsed = JSON.parse(raw);
        } catch (e) {
          parsed = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
        });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function extractCookie(setCookie) {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map(c => c.split(';')[0]).join('; ');
}

async function registerOrLogin(username, password) {
  let r = await request('POST', '/api/register', { body: { username, password } });
  if (r.status === 409) {
    r = await request('POST', '/api/login', { body: { username, password } });
  }
  if (r.status !== 200) {
    throw new Error(`auth ${username} 失败: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return {
    cookie: extractCookie(r.headers['set-cookie']),
    user: r.body.user
  };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('✗ [E2E FAIL]', msg);
    process.exitCode = 1;
    throw new Error(msg);
  } else {
    console.log('✓ [E2E PASS]', msg);
  }
}

async function run() {
  console.log('=== 开始 Step 7 E2E 历史记录接口测试 ===');

  const tag = Date.now().toString(36);
  const username = 'tester_' + tag;
  
  // 1. 登录/注册测试玩家
  console.log('\n[1] 正在注册/登录测试玩家...');
  const authRes = await registerOrLogin(username, 'pw123456');
  const userId = authRes.user.id;
  const cookie = authRes.cookie;
  console.log(`  - 玩家 ${username} 登录成功，用户 ID 为 ${userId}`);

  // 2. 验证未登录时拦截
  console.log('\n[2] 验证未登录时访问历史接口...');
  const unauthRes = await request('GET', '/api/history');
  assert(unauthRes.status === 401, '未登录时访问 /api/history 应当返回 401 未登录状态码');
  assert(unauthRes.body.message === '未登录', '未登录时应当返回 "未登录" 信息');

  // 3. 在 SQLite 中手动插入多种模拟手牌记录以进行接口与描述解析验证
  console.log('\n[3] 向数据库写入各种场景的手牌模拟记录...');
  
  // 3.1 摊牌获胜场景 (两对)
  const holeCardsA = [{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♦' }];
  const communityCardsA = [
    { rank: 'A', suit: '♥' }, { rank: 'K', suit: '♣' }, { rank: '2', suit: '♦' },
    { rank: '5', suit: '♠' }, { rank: '8', suit: '♥' }
  ];
  const actionLogA = [
    { seatId: 1, type: 'call', amount: 10, phase: 'preflop' },
    { seatId: 1, type: 'check', phase: 'flop' }
  ];
  db.prepare(`
    INSERT INTO hand_history (user_id, hand_id, ended_at, result, profit, chips_after, hole_cards, community_cards, action_summary, seat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    'hand_mock_1',
    Date.now() - 5000,
    'win',
    350,
    1350,
    JSON.stringify(holeCardsA),
    JSON.stringify(communityCardsA),
    JSON.stringify(actionLogA),
    1 // seat_id
  );

  // 3.2 对手全弃牌赢得底池 (无 community 牌)
  db.prepare(`
    INSERT INTO hand_history (user_id, hand_id, ended_at, result, profit, chips_after, hole_cards, community_cards, action_summary, seat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    'hand_mock_2',
    Date.now() - 4000,
    'win',
    50,
    1400,
    JSON.stringify([{ rank: 'J', suit: '♣' }, { rank: 'Q', suit: '♠' }]),
    JSON.stringify([]),
    JSON.stringify([{ seatId: 1, type: 'raise', amount: 30, phase: 'preflop' }]),
    1 // seat_id
  );

  // 3.3 翻牌圈弃牌落败场景
  const actionLogC = [
    { seatId: 1, type: 'call', amount: 10, phase: 'preflop' },
    { seatId: 1, type: 'fold', phase: 'flop' }
  ];
  db.prepare(`
    INSERT INTO hand_history (user_id, hand_id, ended_at, result, profit, chips_after, hole_cards, community_cards, action_summary, seat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    'hand_mock_3',
    Date.now() - 3000,
    'loss',
    -10,
    1390,
    JSON.stringify([{ rank: '2', suit: '♣' }, { rank: '7', suit: '♠' }]),
    JSON.stringify([{ rank: 'A', suit: '♥' }, { rank: 'K', suit: '♣' }, { rank: 'J', suit: '♦' }]),
    JSON.stringify(actionLogC),
    1 // seat_id
  );

  // 3.4 摊牌落败场景
  const holeCardsD = [{ rank: '9', suit: '♠' }, { rank: '9', suit: '♦' }];
  const communityCardsD = [
    { rank: 'A', suit: '♥' }, { rank: 'K', suit: '♣' }, { rank: 'J', suit: '♦' },
    { rank: 'Q', suit: '♠' }, { rank: '8', suit: '♥' }
  ];
  db.prepare(`
    INSERT INTO hand_history (user_id, hand_id, ended_at, result, profit, chips_after, hole_cards, community_cards, action_summary, seat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    'hand_mock_4',
    Date.now() - 2000,
    'loss',
    -100,
    1290,
    JSON.stringify(holeCardsD),
    JSON.stringify(communityCardsD),
    JSON.stringify([{ seatId: 1, type: 'call', amount: 100, phase: 'river' }]),
    1 // seat_id
  );

  // 4. 发送已认证的 GET 请求拉取历史记录
  console.log('\n[4] 正在使用 Cookie 拉取手牌历史数据...');
  const historyRes = await request('GET', '/api/history', { cookie });
  assert(historyRes.status === 200, '请求应当成功返回 200');
  
  const history = historyRes.body.history;
  assert(Array.isArray(history), '返回的 history 应该是一个数组');
  assert(history.length >= 4, '手牌历史列表应至少包含刚刚插入的 4 条模拟记录');

  console.log('\n[5] 开始验证各个手牌事件的智能中文描述与格式解析...');

  // 排序验证：应按时间倒序排列 (Ended_at desc)
  // hand_mock_4 (ended_at 最小的偏差, 即最新), hand_mock_3, hand_mock_2, hand_mock_1
  const h4 = history.find(h => h.id === 'hand_mock_4');
  const h3 = history.find(h => h.id === 'hand_mock_3');
  const h2 = history.find(h => h.id === 'hand_mock_2');
  const h1 = history.find(h => h.id === 'hand_mock_1');

  // 断言 hand_mock_1 (摊牌获胜两对)
  console.log(`  - 校验 hand_mock_1 行动描述: "${h1.action}"`);
  assert(h1.result === 'win', '结果应为 win');
  assert(h1.profit === 350, '盈利应为 +350');
  assert(h1.finalChips === 1350, '最终筹码应为 1350');
  assert(h1.action.includes('摊牌胜出') && h1.action.includes('两对'), '行动描述应正确推导并包含 "进入摊牌胜出，牌型【两对】"');

  // 断言 hand_mock_2 (对手全弃牌赢得底池)
  console.log(`  - 校验 hand_mock_2 行动描述: "${h2.action}"`);
  assert(h2.result === 'win', '结果应为 win');
  assert(h2.profit === 50, '盈利应为 +50');
  assert(h2.action === '对手全弃牌，赢得底池', '行动描述应为 "对手全弃牌，赢得底池"');

  // 断言 hand_mock_3 (翻牌圈弃牌落败)
  console.log(`  - 校验 hand_mock_3 行动描述: "${h3.action}"`);
  assert(h3.result === 'loss', '结果应为 loss');
  assert(h3.profit === -10, '盈利应为 -10');
  assert(h3.action === '在 翻牌圈 弃牌', '行动描述应为 "在 翻牌圈 弃牌"');

  // 断言 hand_mock_4 (进入摊牌落败一对)
  console.log(`  - 校验 hand_mock_4 行动描述: "${h4.action}"`);
  assert(h4.result === 'loss', '结果应为 loss');
  assert(h4.profit === -100, '盈利应为 -100');
  assert(h4.action.includes('摊牌落败') && h4.action.includes('一对'), '行动描述应正确推导并包含 "进入摊牌落败，牌型【一对】"');

  // 5. 校验卡牌格式
  assert(Array.isArray(h1.hole_cards) && h1.hole_cards.length === 2, '底牌应作为独立数组返回');
  assert(Array.isArray(h1.community_cards) && h1.community_cards.length === 5, '公共牌应作为独立数组返回');

  // 6. 清理插入的 mock 数据
  console.log('\n[6] 正在清理临时测试数据...');
  db.prepare("DELETE FROM hand_history WHERE hand_id LIKE 'hand_mock_%'").run();
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  db.close();

  console.log('\n=== Step 7 E2E 历史记录接口测试全部通过! ===');
}

run().catch(err => {
  console.error('E2E 测试流程异常中断:', err);
  process.exit(1);
});
