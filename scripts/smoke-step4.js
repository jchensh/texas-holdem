/**
 * Step 4 冒烟测试：Socket.IO 握手 + lobby_state 广播
 *
 * 用法：先用别的端口起 server (PORT=3010 node server/index.js)，再:
 *   node scripts/smoke-step4.js
 *
 * 验证：
 *   1. 未登录的 socket 连接被拒（'未登录' 错误）
 *   2. 两个用户分别登录后，socket 都能拿到 lobby_state
 *   3. 列表里两个用户都在，count = 2
 *   4. 一个用户断开后，另一个收到 count = 1 的更新
 *   5. 同一用户开两条 socket，按 userId 去重，count 仍为 1（叠加另一用户后 = 2）
 */
const http = require('http');
const { io: ioClient } = require('socket.io-client');

const PORT = process.env.PORT || 3010;
const BASE = `http://localhost:${PORT}`;

// --- HTTP 辅助（裸 http，避开系统代理） ---
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

// 从 Set-Cookie header 提取出可回传的 Cookie 串
function extractCookie(setCookie) {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map(c => c.split(';')[0]).join('; ');
}

async function registerOrLogin(username, password) {
  // 先尝试注册；冲突就回退到登录
  let r = await request('POST', '/api/register', { body: { username, password } });
  if (r.status === 409) {
    r = await request('POST', '/api/login', { body: { username, password } });
  }
  if (r.status !== 200) {
    throw new Error(`auth ${username} 失败：${r.status} ${JSON.stringify(r.body)}`);
  }
  return extractCookie(r.headers['set-cookie']);
}

function connectSocket(cookie, label) {
  return new Promise((resolve, reject) => {
    const sock = ioClient(BASE, {
      transports: ['websocket'],  // 跳过 polling，直接 ws，避免 cookie 问题
      extraHeaders: cookie ? { Cookie: cookie } : {},
    });
    sock.on('connect',       () => { console.log(`  [${label}] connect ✓`); resolve(sock); });
    sock.on('connect_error', (err) => { console.log(`  [${label}] connect_error: ${err.message}`); reject(err); });
  });
}

function nextLobbyState(sock, label, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`[${label}] 等 lobby_state 超时`)), timeoutMs);
    function handler(state) {
      console.log(`  [${label}] lobby_state:`, JSON.stringify(state));
      if (!predicate || predicate(state)) {
        clearTimeout(t);
        sock.off('lobby_state', handler);
        resolve(state);
      }
    }
    sock.on('lobby_state', handler);
  });
}

function assert(cond, msg) {
  if (!cond) { console.error('✗', msg); process.exitCode = 1; }
  else       { console.log('✓', msg); }
}

(async () => {
  // ── 用例 1：未登录的连接应被拒 ──
  console.log('\n用例 1：未登录连接应被拒');
  try {
    await connectSocket(null, 'anon');
    assert(false, '未登录的连接竟然成功了');
  } catch (e) {
    assert(/未登录|Unauthorized/i.test(e.message), `未登录连接被拒（${e.message}）`);
  }

  // ── 准备两个账号 ──
  const tag = Date.now().toString(36);  // 防止重跑撞用户名
  const userA = 'smokeA_' + tag;
  const userB = 'smokeB_' + tag;
  const cookieA = await registerOrLogin(userA, 'pw123456');
  const cookieB = await registerOrLogin(userB, 'pw123456');

  // ── 用例 2：A 登录连接 → 收到 count=1 ──
  console.log('\n用例 2：A 登录后收到自己');
  const sockA = await connectSocket(cookieA, userA);
  const stateA1 = await nextLobbyState(sockA, userA, (s) => s.count === 1);
  assert(stateA1.players.some(p => p.username === userA), `A 列表里有自己`);

  // ── 用例 3：B 登录后 A 也收到 count=2 ──
  console.log('\n用例 3：B 加入后两边都收到 count=2');
  const waitA2 = nextLobbyState(sockA, userA, (s) => s.count === 2);
  const sockB  = await connectSocket(cookieB, userB);
  const [stateA2, stateB1] = await Promise.all([
    waitA2,
    nextLobbyState(sockB, userB, (s) => s.count === 2),
  ]);
  assert(stateA2.count === 2 && stateB1.count === 2, '广播 count=2');
  const names = stateA2.players.map(p => p.username).sort();
  assert(names.includes(userA) && names.includes(userB), `两人均在列表：${names.join(',')}`);

  // ── 用例 4：A 同账号开第二条 socket，count 仍为 2（去重） ──
  console.log('\n用例 4：A 开第二条 socket 应去重');
  const sockA2 = await connectSocket(cookieA, userA + '#2');
  const stateA2nd = await nextLobbyState(sockA2, userA + '#2');  // 任何 state 都行
  assert(stateA2nd.count === 2, `userId 去重后 count=2（实际 ${stateA2nd.count}）`);

  // ── 用例 5：A 一条 socket 断开，count 仍为 2；两条都断 → count=1 ──
  console.log('\n用例 5：A 部分断开仍计 1 人，全断后归 0');
  sockA2.disconnect();
  // 给 server 一拍传播
  await new Promise(r => setTimeout(r, 200));
  const stateAfterPartial = await new Promise((resolve) => {
    let last = null;
    const handler = (s) => { last = s; };
    sockB.on('lobby_state', handler);
    setTimeout(() => { sockB.off('lobby_state', handler); resolve(last); }, 400);
  });
  // 注意：A 第二条断开时 server 也会广播；但因 userA 还有一条活跃 socket，count 应仍为 2
  // 这里允许 stateAfterPartial 为 null（没收到广播说明列表没变 → 也 OK）
  if (stateAfterPartial) {
    assert(stateAfterPartial.count === 2, `A 部分断开后 count=2（实际 ${stateAfterPartial.count}）`);
  } else {
    console.log('  （A#2 断开后未触发可见变更，符合预期）');
  }

  // A 全部断开
  const waitB2 = nextLobbyState(sockB, userB, (s) => s.count === 1);
  sockA.disconnect();
  const stateB2 = await waitB2;
  assert(stateB2.count === 1 && stateB2.players[0].username === userB,
         'A 全断后 B 收到 count=1，只剩 B');

  // 收尾
  sockB.disconnect();
  console.log('\n完成');
  setTimeout(() => process.exit(), 200);
})().catch((err) => {
  console.error('测试异常：', err);
  process.exit(1);
});
