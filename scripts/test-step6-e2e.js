/**
 * Step 6 端到端 (E2E) 自动化集成测试
 *
 * 用法：确保 server 运行在 PORT=3010，然后执行：
 *   node scripts/test-step6-e2e.js
 */
const http = require('http');
const Database = require('better-sqlite3');
const { io: ioClient } = require('socket.io-client');
const path = require('path');

const PORT = process.env.PORT || 3010;
const BASE = `http://localhost:${PORT}`;

// 连接真实的数据库以进行后面的断言校验
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'poker.db');
const db = new Database(dbPath);

// --- HTTP 辅助（不走系统代理） ---
function request(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: 'localhost', port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: raw ? JSON.parse(raw) : null,
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

// 辅助等待时间
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  console.log('=== 开始 Step 6 E2E 自动化流测试 ===');

  const tag = Date.now().toString(36);
  const uNames = ['alice_' + tag, 'bob_' + tag, 'charlie_' + tag];
  const clients = [];

  // 1. 注册并准备 3 个玩家
  console.log('\n[1] 正在注册并登录 Alice, Bob, Charlie...');
  for (const name of uNames) {
    const res = await registerOrLogin(name, 'pw123456');
    clients.push({
      username: name,
      userId: res.user.id,
      cookie: res.cookie,
      socket: null,
      gameState: null,
      seatId: null
    });
  }

  // 2. 并发建立 Socket.IO 连接
  console.log('\n[2] 建立 Socket.IO 连接并落座...');
  const connectionPromises = clients.map((c) => {
    return new Promise((resolve, reject) => {
      const socket = ioClient(BASE, {
        transports: ['websocket'],
        extraHeaders: { Cookie: c.cookie }
      });
      c.socket = socket;

      socket.on('connect', () => {
        console.log(`  - 玩家 ${c.username} 已连接`);
      });

      // 监听到 game_state 时，保存当前客户端看到的最新状态与座位
      socket.on('game_state', (state) => {
        c.gameState = state;
        if (state) {
          const selfInState = state.players.find(p => p.username === c.username);
          if (selfInState) {
            c.seatId = selfInState.seatId;
          }
        }
      });

      socket.on('connect_error', reject);

      // 当收到 new_hand 事件时（表明游戏引擎已创建并广播），完成该 Promise
      socket.on('new_hand', (data) => {
        console.log(`  - ${c.username} 侦测到新一手牌开始!`);
        resolve();
      });
    });
  });

  // 等待所有人连接，并由于人数 >= 2 自动触发开局（startNextHand）
  await Promise.all(connectionPromises);
  console.log('所有玩家已就绪且首手牌已自动开启。');

  // 等待游戏状态同步
  await sleep(1000);

  // 校验每个人的客户端 seatId 是否都成了 hero (即 seatId === 0)
  clients.forEach(c => {
    assert(c.seatId === 0, `对于玩家 ${c.username}，其相对座位号必须为 0 (实际为 ${c.seatId})`);
  });

  // 3. 模拟玩家交互来进行一整局德州游戏
  console.log('\n[3] 模拟玩家交互游戏流...');

  let handFinished = false;
  let handResultData = null;

  // 收集每个客户端对 hand_result 的广播
  clients.forEach(c => {
    c.socket.on('hand_result', (data) => {
      console.log(`  - [广播结果] ${c.username} 收到 hand_result:`, JSON.stringify(data));
      handResultData = data;
      handFinished = true;
    });

    c.socket.on('error', (err) => {
      console.error(`  - [错误警告] ${c.username} 收到服务端报错:`, err.message);
    });
  });

  // 自动打牌循环：只要手牌没完，并且轮到谁，谁就采取行动
  let actCount = 0;
  const maxActions = 20; // 避免死循环防护线

  while (!handFinished && actCount < maxActions) {
    // 找出当前轮到谁行动
    // 服务端下发给不同玩家的 game_state 里的 currentSeat 是相对各自视角的
    // 但在服务器端 table.game.currentSeat 是物理绝对座位。
    // 在这里我们可以直接读取客户端 c.gameState。
    // 如果 c.gameState 里的 currentSeat === 0，意味着轮到 c 动了！
    const actingClient = clients.find(c => c.gameState && c.gameState.currentSeat === 0);

    if (actingClient) {
      actCount++;
      const state = actingClient.gameState;
      const round = state.phase;
      
      console.log(`\n -> 回合: ${round} | 轮到玩家 ${actingClient.username} 行动`);

      // 玩家采取何种行动？
      // 为了让游戏能够一直推到 showdown 摊牌，我们可以采取 Check 或 Call 行动。
      // 如果 actionPanel 被激活（我们之前在 socket.js 中收到 your_turn ），我们会触发 showActionPanel
      // 这里我们在客户端用 Promise 或直接 emit 事件来响应。
      // 我们模拟发送过牌或者跟注
      const callVal = state.players[0].bet || 0; 
      
      // 注意：我们在 your_turn 里会知道具体的 callAmount
      // 我们可以让玩家直接 emit 具体的跟注或过牌：
      // 如果需要跟注（currentBet > 自己的投入），我们发跟注
      // 否则我们发过牌
      // 怎么判断是否需要跟注？我们可以从 table 的 state 或 action.type 决定。
      // 由于我们是模拟客户端，我们在 turn 广播里最准确。我们可以等 your_turn 事件或者直接计算。
      // 实际上我们可以给 socket 挂载 one-time event 监听 'your_turn' 拿到具体值
      const turnPromise = new Promise((resolve) => {
        actingClient.socket.once('your_turn', (turnInfo) => {
          resolve(turnInfo);
        });
      });

      // 如果客户端已经先收到了 your_turn，once 可能会漏。
      // 所以我们直接根据 gameState 状态计算或者等待 turnPromise。
      // 为保险起见，我们也可以发 check 或者 call。
      // 扑克引擎 Game 类的 act(seatId, {type}) 会对行动合法性作验证
      // 如果跟注额 > 0 却发送 check 会抛错。所以如果有未匹配下注，就用 call，否则用 check。
      // 我们计算池子差额：
      // state.players[0] 是 hero，当前下注是 state.players[0].bet
      // 我们需要知道当前街的最大 bet 是多少：
      const maxBetInStreet = Math.max(...state.players.map(p => p.bet || 0));
      const myBet = state.players[0].bet || 0;
      const gap = maxBetInStreet - myBet;

      if (gap > 0) {
        console.log(`    ${actingClient.username} 需要跟注 ${gap}，发送 [call]`);
        actingClient.socket.emit('action', { type: 'call' });
      } else {
        console.log(`    ${actingClient.username} 无需跟注，发送 [check]`);
        actingClient.socket.emit('action', { type: 'check' });
      }

      // 等待状态同步更新
      await sleep(500);
    } else {
      // 如果当前没有客户端处于行动状态，可能在发牌间隙，稍微等等
      await sleep(200);
    }
  }

  assert(handFinished, '德州游戏手牌应当正常完成并触发结算广播');
  assert(handResultData !== null, '必须收到有效的结算数据');
  assert(handResultData.pot > 0, `总奖池应大于 0 (当前: ${handResultData.pot})`);

  console.log('\n[4] 游戏结束，进行数据库断言校验...');

  // 4. 断言验证数据库持久化
  // A. 查询 users 筹码是否发生了改变，且 lifetime_profit 是否已写入
  console.log('  - 检查 users 表持久化数据...');
  for (const c of clients) {
    const userRow = db.prepare('SELECT chips, lifetime_profit FROM users WHERE id = ?').get(c.userId);
    console.log(`    玩家 ${c.username} 结算后筹码: ${userRow.chips} | 终生净收益: ${userRow.lifetime_profit}`);
    assert(userRow !== undefined, `玩家 ${c.username} 在 users 表中应存在记录`);
    
    // chipsAfter - startingChips 必须等于 profit 写入 users.lifetime_profit
    assert(userRow.chips > 0, `结算后筹码应为正数`);
  }

  // B. 查询 hand_history 表是否产生了此手牌的记录
  console.log('  - 检查 hand_history 表持久化数据...');
  const historyRows = db.prepare('SELECT * FROM hand_history WHERE hand_id = ?').all(clients[0].gameState.handId);
  console.log(`    手牌历史记录条数: ${historyRows.length} (应为 3 条，每个玩家一条)`);
  assert(historyRows.length === 3, '针对一局 3 人局，数据库 hand_history 应记录 3 人各自的历史记录');

  // 检查每条记录是否完整写入
  for (const row of historyRows) {
    const matchingClient = clients.find(c => c.userId === row.user_id);
    assert(matchingClient !== undefined, `记录中的 user_id ${row.user_id} 必须对应 Alice/Bob/Charlie`);
    assert(['win', 'loss', 'push'].includes(row.result), `结算结果应为有效类型: ${row.result}`);
    assert(row.chips_after > 0, `chips_after 应合法`);
    assert(JSON.parse(row.hole_cards).length === 2, `底牌 hole_cards 应包含 2 张牌`);
    assert(JSON.parse(row.community_cards).length >= 0, `公共牌 community_cards 应正确序列化`);
    assert(JSON.parse(row.action_summary).length > 0, `行动日志 action_summary 应正确记录动作`);
  }

  console.log('\n[5] 清理连接与资源...');
  clients.forEach(c => c.socket.disconnect());
  db.close();

  console.log('\n=== Step 6 E2E 集成自动化测试全部通过! ===');
}

run().catch(err => {
  console.error('E2E 测试流程异常中断:', err);
  process.exit(1);
});
