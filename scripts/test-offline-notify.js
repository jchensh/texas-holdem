/**
 * 离线 / 重连全局强通知弹窗 端到端 (E2E) 自动化测试
 *
 * 验证 Step 8 遗留问题：玩家牌局中掉线时，对手应收到全局 global_notification（type=offline）；
 * 该玩家重连回桌时，对手应收到 global_notification（type=online）。
 *
 * 用法：确保 server 运行在 PORT=3010，然后执行：
 *   node scripts/test-offline-notify.js
 *
 * ⚠ 终端调本地 server 前先 `export NO_PROXY=localhost,127.0.0.1`（见 CLAUDE.md 代理坑）。
 */
const http = require('http');
const { io: ioClient } = require('socket.io-client');

const PORT = process.env.PORT || 3010;
const BASE = `http://localhost:${PORT}`;

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
        resolve({ status: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null });
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
  return { cookie: extractCookie(r.headers['set-cookie']), user: r.body.user };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('✗ [E2E FAIL]', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('✓ [E2E PASS]', msg);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 连接一个玩家并挂上 game_state / global_notification 收集器
function connectClient(c) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE, {
      transports: ['websocket'],
      extraHeaders: { Cookie: c.cookie },
    });
    c.socket = socket;
    c.notifications = c.notifications || [];

    socket.on('game_state', (state) => {
      c.gameState = state;
      if (state) {
        const self = state.players.find(p => p.username === c.username);
        if (self) c.seatId = self.seatId;
      }
    });
    socket.on('global_notification', (data) => {
      console.log(`  - [通知] ${c.username} 收到 global_notification: type=${data.type}, username=${data.username}`);
      c.notifications.push(data);
    });
    socket.on('connect_error', reject);
    socket.on('new_hand', () => resolve());
    // 兜底：即便没赶上 new_hand（如已在局中），也在连接后尽快 resolve
    socket.on('connect', () => setTimeout(resolve, 1500));
  });
}

async function run() {
  console.log('=== 开始 离线/重连 全局通知 E2E 测试 ===');

  const tag = Date.now().toString(36);
  const uNames = ['alice_' + tag, 'bob_' + tag, 'charlie_' + tag];
  const clients = [];

  console.log('\n[1] 注册并登录 Alice, Bob, Charlie...');
  for (const name of uNames) {
    const res = await registerOrLogin(name, 'pw123456');
    clients.push({ username: name, userId: res.user.id, cookie: res.cookie, socket: null, gameState: null, seatId: null, notifications: [] });
  }

  console.log('\n[2] 建立 Socket.IO 连接并等待自动开局...');
  await Promise.all(clients.map(connectClient));
  await sleep(1000);

  const [alice, bob, charlie] = clients;
  assert(charlie.gameState && charlie.gameState.phase !== 'ended', 'Charlie 应处于进行中的手牌内');

  // 清空连接阶段可能产生的历史通知，只观察“掉线之后”新增的
  alice.notifications = [];
  bob.notifications = [];

  console.log('\n[3] 断开 Charlie 的连接，模拟掉线...');
  charlie.socket.disconnect();
  await sleep(600);

  const aliceOffline = alice.notifications.find(n => n.type === 'offline' && n.username === charlie.username);
  const bobOffline = bob.notifications.find(n => n.type === 'offline' && n.username === charlie.username);
  assert(aliceOffline, `Alice 应收到 Charlie 的 offline 全局通知`);
  assert(bobOffline, `Bob 应收到 Charlie 的 offline 全局通知`);
  assert(/掉线/.test(aliceOffline.message), 'offline 通知文案应包含“掉线”字样');

  // 重置收集器，准备观察重连通知
  alice.notifications = [];
  bob.notifications = [];

  console.log('\n[4] Charlie 重新连线回桌...');
  await connectClient(charlie);
  await sleep(600);

  const aliceOnline = alice.notifications.find(n => n.type === 'online' && n.username === charlie.username);
  const bobOnline = bob.notifications.find(n => n.type === 'online' && n.username === charlie.username);
  assert(aliceOnline, `Alice 应收到 Charlie 的 online 回归通知`);
  assert(bobOnline, `Bob 应收到 Charlie 的 online 回归通知`);
  assert(/重新连线|回到/.test(aliceOnline.message), 'online 通知文案应包含“重新连线/回到”字样');

  console.log('\n[5] 清理连接...');
  clients.forEach(c => c.socket && c.socket.connected && c.socket.disconnect());

  console.log('\n=== 离线/重连 全局通知 E2E 测试全部通过! ===');
}

run().catch(err => {
  console.error('E2E 测试流程异常中断:', err);
  process.exit(1);
});
