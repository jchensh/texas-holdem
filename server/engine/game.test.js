const test = require('node:test');
const assert = require('node:assert');

const { Game } = require('./game');

// ── 辅助 ──────────────────────────────────────────

const suitMap = { s: '♠', h: '♥', d: '♦', c: '♣' };
function card(spec) {
  return { rank: spec.slice(0, -1), suit: suitMap[spec.slice(-1)] };
}
/** 列表中第一张是"首先发出去"的牌；内部把它放到 deck 末尾，pop 时先弹出 */
function deckOf(...dealOrder) {
  return dealOrder.map(card).reverse();
}

function mkPlayers(...specs) {
  // specs: [{ seatId, chips }] —— 自动派 id/username
  return specs.map((s, i) => ({
    id:       100 + i,
    seatId:   s.seatId,
    username: 'P' + s.seatId,
    chips:    s.chips ?? 1000,
  }));
}

// ── 初始化 ────────────────────────────────────────

test('heads-up：庄家发 SB，对手发 BB，SB 先行', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }),
    dealerSeat: 0,
    smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  // 各 2 张手牌
  assert.strictEqual(g.players[0].holeCards.length, 2);
  assert.strictEqual(g.players[1].holeCards.length, 2);
  // 盲注：seat 0 = SB(5)，seat 1 = BB(10)
  assert.strictEqual(g.players[0].currentBet, 5);
  assert.strictEqual(g.players[1].currentBet, 10);
  assert.strictEqual(g.players[0].chips, 995);
  assert.strictEqual(g.players[1].chips, 990);
  // heads-up：SB 先动
  assert.strictEqual(g.currentSeat, 0);
});

test('3 人：dealer 下家 SB，再下家 BB，UTG 先行', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }, { seatId: 2 }),
    dealerSeat: 0,
    smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  assert.strictEqual(g.players[1].currentBet, 5);  // SB
  assert.strictEqual(g.players[2].currentBet, 10); // BB
  // dealer 是 0，UTG = BB 下家 = 0
  assert.strictEqual(g.currentSeat, 0);
});

test('少于 2 人构造抛错', () => {
  assert.throws(() => new Game({
    players: mkPlayers({ seatId: 0 }),
    dealerSeat: 0,
    smallBlind: 5, bigBlind: 10, handId: 'h1',
  }), /至少 2 人/);
});

// ── 弃牌胜出 ──────────────────────────────────────

test('heads-up：SB 弃牌，BB 直接赢回盲注', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  const evt = g.act(0, { type: 'fold' });
  assert.strictEqual(evt.type, 'hand_end');
  assert.strictEqual(evt.reason, 'fold');
  // BB 拿走 pot=15
  assert.strictEqual(g.players[1].chips, 990 + 15);
  assert.strictEqual(g.players[0].chips, 995);  // SB 只赔了盲注
  // results.summary 标注
  const s0 = evt.results.summary.find(s => s.seatId === 0);
  const s1 = evt.results.summary.find(s => s.seatId === 1);
  assert.strictEqual(s0.result, 'loss');
  assert.strictEqual(s0.profit, -5);
  assert.strictEqual(s1.result, 'win');
  assert.strictEqual(s1.profit, 5);   // BB 投 10，拿回 SB 押的 5，净 +5
});

// ── 行动校验 ──────────────────────────────────────

test('非自己回合行动抛错', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }, { seatId: 2 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  // currentSeat=0；让 seat 1 强行行动
  assert.throws(() => g.act(1, { type: 'fold' }), /不是 seat 1 的回合/);
});

test('当前有注时不能 check', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }, { seatId: 2 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  // seat 0 (UTG) 面对 currentBet=10
  assert.throws(() => g.act(0, { type: 'check' }), /不能过牌/);
});

test('无注时不能 call', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }, { seatId: 2 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  // 推进到 flop：所有人 call/check
  g.act(0, { type: 'call' });
  g.act(1, { type: 'call' });
  g.act(2, { type: 'check' });
  assert.strictEqual(g.phase, 'flop');
  // flop 首先行动是 SB(seat 1)，currentBet=0
  assert.strictEqual(g.currentSeat, 1);
  assert.throws(() => g.act(1, { type: 'call' }), /无需跟注/);
});

test('加注必须严格大于 currentBet', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }, { seatId: 2 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  assert.throws(() => g.act(0, { type: 'raise', amount: 10 }), /必须大于/);
});

test('加注增量必须 ≥ minRaise', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }, { seatId: 2 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  // BB=10, minRaise=10。加到 15 增量 5，不合法
  assert.throws(() => g.act(0, { type: 'raise', amount: 15 }), /增量至少/);
});

test('合法加注后重新打开他人行动', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }, { seatId: 2 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1',
  });
  // UTG raise 到 30
  g.act(0, { type: 'raise', amount: 30 });
  assert.strictEqual(g.currentBet, 30);
  assert.strictEqual(g.minRaise, 20);
  // 接下来 SB
  assert.strictEqual(g.currentSeat, 1);
  g.act(1, { type: 'call' });           // SB 跟注到 30
  g.act(2, { type: 'raise', amount: 60 });  // BB 再加注
  // raise 后 UTG 的 hasActedThisRound 应被重置
  assert.strictEqual(g.players[0].hasActedThisRound, false);
  assert.strictEqual(g.currentSeat, 0);
});

// ── 摊牌结果 ──────────────────────────────────────

test('heads-up showdown：seat 0 同花击败 seat 1 对子', () => {
  // 发牌顺序（仅 9 张）：seat1.1, seat0.1, seat1.2, seat0.2, flop×3, turn, river
  const deck = deckOf(
    '7d', 'As',   // 手牌轮 1：seat1, seat0
    '7c', 'Ks',   // 手牌轮 2：seat1, seat0
    '2s', '5s', '9s',  // flop
    'Jd',         // turn
    '4h',         // river
  );
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1', deck,
  });
  // seat 0 = As Ks；seat 1 = 7d 7c
  assert.deepStrictEqual(g.players[0].holeCards.map(c => c.rank + c.suit), ['A♠', 'K♠']);
  assert.deepStrictEqual(g.players[1].holeCards.map(c => c.rank + c.suit), ['7♦', '7♣']);

  // 全程一路过：SB(0) call 5 → BB(1) check → flop → BB(1) check → SB(0) check → turn → check check → river → check check → showdown
  g.act(0, { type: 'call' });  // call 到 10
  g.act(1, { type: 'check' }); // BB option check → 进入 flop

  // flop：BB(1) 先行（heads-up postflop dealer 下家先）
  assert.strictEqual(g.phase, 'flop');
  assert.strictEqual(g.currentSeat, 1);
  g.act(1, { type: 'check' });
  g.act(0, { type: 'check' });

  assert.strictEqual(g.phase, 'turn');
  g.act(1, { type: 'check' });
  g.act(0, { type: 'check' });

  assert.strictEqual(g.phase, 'river');
  g.act(1, { type: 'check' });
  const evt = g.act(0, { type: 'check' });

  assert.strictEqual(evt.type, 'hand_end');
  assert.strictEqual(evt.reason, 'showdown');

  // seat 0 同花 A♠ K♠ + 9♠ 5♠ 2♠ 胜
  const s0 = evt.results.summary.find(s => s.seatId === 0);
  const s1 = evt.results.summary.find(s => s.seatId === 1);
  assert.strictEqual(s0.result, 'win');
  assert.strictEqual(s0.profit, 10);   // 各押 10
  assert.strictEqual(s1.result, 'loss');
  assert.strictEqual(s1.profit, -10);
  assert.strictEqual(s0.categoryName, '同花');
});

test('摊牌后 holeCards 全员可见', () => {
  const deck = deckOf('7d', 'As', '7c', 'Ks', '2s', '5s', '9s', 'Jd', '4h');
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1', deck,
  });
  // 跑完
  g.act(0, { type: 'call' });
  g.act(1, { type: 'check' });
  for (const seat of [1, 0, 1, 0, 1, 0]) g.act(seat, { type: 'check' });

  const snap = g.getPublicState(null); // 无 viewer 也能看到所有 holeCards
  assert.ok(snap.players.every(p => p.holeCards.length === 2));
});

// ── 边池 / all-in ────────────────────────────────

test('all-in 短堆 vs 大堆：边池正确切分并归属', () => {
  // 3 人：A(短堆 50)，B(200)，C(200)
  // 牌面：让 A 胜出主池，B 胜出边池（构造方便：A 拿到大牌、B 第二、C 最差）
  //
  // 发牌顺序（dealer=0=C，对手=1=A，2=B）：
  //   _seatsAfter(0) = [1, 2, 0] → 手牌轮：seat1, seat2, seat0; 再次相同
  //   blinds: SB=seat1(A)=5, BB=seat2(B)=10
  // 但 A 短堆只有 50，构造时 chips=50。这就让盲注后 A 还剩 45。
  //
  // 我们让 UTG(C) all-in 50，SB(A) all-in 剩余（45 更不够，但 A 是短堆），BB(B) call 50。
  // 这里改成更简单的脚本：让 C 加注，A all-in，B call。
  //
  // 牌：
  //   A 拿 As Ah → 两对最强候选（葫芦机会）
  //   B 拿 Ks Kh → 两对 K
  //   C 拿 2c 3d → 烂牌
  //   board: 4s 5h 9d Jc 7s （无对，A 拿一对 A，B 拿一对 K，C 高牌）
  //   →  A 一对 A 胜过 B 一对 K 胜过 C 高牌
  //
  // 发牌顺序（手牌轮 1：1,2,0；轮 2：1,2,0）：
  //   1(A) ← As, 2(B) ← Ks, 0(C) ← 2c
  //   1(A) ← Ah, 2(B) ← Kh, 0(C) ← 3d
  //   flop: 4s, 5h, 9d
  //   turn: Jc
  //   river: 7s
  const deck = deckOf(
    'As', 'Ks', '2c',
    'Ah', 'Kh', '3d',
    '4s', '5h', '9d',
    'Jc',
    '7s',
  );

  const g = new Game({
    players: [
      { id: 1, seatId: 1, username: 'A', chips: 50 },
      { id: 2, seatId: 2, username: 'B', chips: 200 },
      { id: 3, seatId: 0, username: 'C', chips: 200 },
    ],
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h1', deck,
  });
  // blinds: A=SB(5)→45 left, B=BB(10)→190 left；C=200
  assert.strictEqual(g.players.find(p => p.seatId === 1).chips, 45);
  assert.strictEqual(g.players.find(p => p.seatId === 2).chips, 190);
  assert.strictEqual(g.currentSeat, 0);

  // C 加注到 50（增量 40 ≥ minRaise 10 ✓）
  g.act(0, { type: 'raise', amount: 50 });
  // A 跟注（所剩仅 45，need=50-5=45；触发 all-in）
  g.act(1, { type: 'call' });
  assert.strictEqual(g.players.find(p => p.seatId === 1).status, 'allin');
  // B 跟注（need=40，剩 190 足够）
  const evt = g.act(2, { type: 'call' });

  // 这时活跃可下注的（status='active'）剩 2 人(B, C)；A all-in
  // 实际上 A 是 SB 投了 50（短堆），B 投 50，C 投 50，主池均 150，没有边池
  // 进入 flop 后 B/C 继续下注或都过
  // 等等：A all-in 50，B 投 50，C 投 50 → 三人投入相同 → 只有 1 个主池
  // 既然 B 和 C 都还有筹码且 A all-in，下注轮可继续（B/C 间），但牌面 A 已不能再行动
  assert.strictEqual(evt.type, 'round_end');
  assert.strictEqual(evt.phase, 'flop');

  // flop：SB(A) 已 all-in 跳过 → 第一个 active 是 B(seat 2)
  // 不对 —— 翻后从 dealer 下家开始 = seat 1 (A)，但 A all-in 跳过 → seat 2 (B)
  assert.strictEqual(g.currentSeat, 2);
  g.act(2, { type: 'check' });
  g.act(0, { type: 'check' });
  // turn
  assert.strictEqual(g.phase, 'turn');
  g.act(2, { type: 'check' });
  g.act(0, { type: 'check' });
  // river
  assert.strictEqual(g.phase, 'river');
  g.act(2, { type: 'check' });
  const final = g.act(0, { type: 'check' });

  assert.strictEqual(final.type, 'hand_end');
  assert.strictEqual(final.reason, 'showdown');

  // 主池 150：A(一对A)胜过 B,C → A 拿 150
  // 没有边池（三人投入相同）
  assert.strictEqual(final.results.pots.length, 1);
  assert.strictEqual(final.results.pots[0].amount, 150);

  const sA = final.results.summary.find(s => s.seatId === 1);
  const sB = final.results.summary.find(s => s.seatId === 2);
  const sC = final.results.summary.find(s => s.seatId === 0);
  assert.strictEqual(sA.won, 150);
  assert.strictEqual(sA.profit, 100);  // paid 50, won 150
  assert.strictEqual(sB.won, 0);
  assert.strictEqual(sB.profit, -50);
  assert.strictEqual(sC.won, 0);
  assert.strictEqual(sC.profit, -50);
  assert.strictEqual(sA.result, 'win');
});

test('真·边池：A short stack 输给 B（主池给 B），C 已弃牌不参与', () => {
  // 4 人：A(50)，B(300)，C(300)，D(300)
  // 让 A all-in 50；C 弃牌；B 加注，D 跟，B 继续打到摊牌赢
  // 简化：让所有人 all-in 到死 ✓
  //
  // 让牌面：B 拿到 AA → 葫芦；A 一对 K；D 一对 Q；C 弃牌
  //
  // dealer = 0 = D
  //   _seatsAfter(0) = [1,2,3,0] = [A, B, C, D]
  //   SB = seat1 = A(50)，BB = seat2 = B
  // 手牌轮 1：A,B,C,D；轮 2：A,B,C,D
  //   A ← Ks, Kh
  //   B ← Ah, Ad
  //   C ← 2c, 3c   (随便)
  //   D ← Qs, Qh
  //   board: As 7d 9h Tc Jd  → B 三条 A 升级为葫芦? 没，board 全单 → B = 三条 A；A = 一对 K；D = 一对 Q
  const deck = deckOf(
    'Ks', 'Ah', '2c', 'Qs',
    'Kh', 'Ad', '3c', 'Qh',
    'As', '7d', '9h',
    'Tc',
    'Jd',
  );

  const g = new Game({
    players: [
      { id: 1, seatId: 1, username: 'A', chips: 50 },
      { id: 2, seatId: 2, username: 'B', chips: 300 },
      { id: 3, seatId: 3, username: 'C', chips: 300 },
      { id: 4, seatId: 0, username: 'D', chips: 300 },
    ],
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h2', deck,
  });
  // 盲注后：A=45, B=290, C=300, D=300
  // UTG = BB+1 = seat 3 = C
  assert.strictEqual(g.currentSeat, 3);

  g.act(3, { type: 'fold' });               // C 弃牌
  g.act(0, { type: 'raise', amount: 100 }); // D raise 100
  g.act(1, { type: 'call' });               // A all-in 50 (剩 45 < need)
  assert.strictEqual(g.players.find(p => p.seatId === 1).status, 'allin');
  g.act(2, { type: 'call' });               // B call 100

  // round 完成？A all-in，B 和 D 都在 100，hasActed=true → 是
  // 但 raise 应该重新打开了 B 的行动；让我们看：D raise→A call→B call。
  // 实际上 D raise 后 A 和 B 的 hasActedThisRound 被重置，然后 A 行动后 hasActed=true，B 行动后 hasActed=true。
  // 都 currentBet=100 → 完成。
  // 此时 active = [B, D]（A all-in），继续到 flop
  assert.strictEqual(g.phase, 'flop');

  // flop 起首动：dealer 下家 = seat 1 (A) all-in 跳过 → seat 2 (B)
  assert.strictEqual(g.currentSeat, 2);
  // B 和 D 继续打：B all-in 余 200，D 跟。先让 B 加注全押
  g.act(2, { type: 'raise', amount: 200 });
  assert.strictEqual(g.players.find(p => p.seatId === 2).status, 'allin');
  // D 跟 200
  const evt = g.act(0, { type: 'call' });

  // 双方 all-in → 一路开到摊牌
  assert.strictEqual(evt.type, 'hand_end');
  assert.strictEqual(evt.reason, 'showdown');

  // pot 切分：A 投 50，B 投 300，C 投 0（弃牌前未投），D 投 300
  //   wait C 弃牌但他没投钱，因为他 UTG 直接 fold（也没盲注，他在 seat 3 不是 SB/BB）
  // 主池：50*3=150（A, B, D）
  // 边池：250*2=500（B, D）
  assert.strictEqual(evt.results.pots.length, 2);
  assert.deepStrictEqual(evt.results.pots[0].amount, 150);
  assert.deepStrictEqual(evt.results.pots[1].amount, 500);

  // 牌力：B 三条 A 最强 → 主池 + 边池都给 B
  const sB = evt.results.summary.find(s => s.seatId === 2);
  assert.strictEqual(sB.won, 650);
  assert.strictEqual(sB.profit, 650 - 300);
  const sA = evt.results.summary.find(s => s.seatId === 1);
  assert.strictEqual(sA.won, 0);
  assert.strictEqual(sA.profit, -50);
  const sD = evt.results.summary.find(s => s.seatId === 0);
  assert.strictEqual(sD.profit, -300);
});

// ── 平分底池 ──────────────────────────────────────

test('两人摊牌完全平手 → 平分底池', () => {
  // 让两人 hole cards 完全无关，公共牌足以决定胜负且各人 best5 相同
  // 简单办法：公共牌就是一对 A + 三高牌；两手 hole 都是小牌且差不多
  //   seat 0 hole: 2c 3c
  //   seat 1 hole: 2d 3d
  //   board: As Ah Kd Qh Jc
  //   双方都用 A A K Q J 作为 best5 → 同分
  const deck = deckOf(
    '2d', '2c',
    '3d', '3c',
    'As', 'Ah', 'Kd',
    'Qh',
    'Jc',
  );
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h3', deck,
  });
  // 跑到摊牌
  g.act(0, { type: 'call' });
  g.act(1, { type: 'check' });
  for (const seat of [1, 0, 1, 0, 1, 0]) g.act(seat, { type: 'check' });

  // 两人各投 10，pot=20，平分各 10
  const s0 = g.results.summary.find(s => s.seatId === 0);
  const s1 = g.results.summary.find(s => s.seatId === 1);
  assert.strictEqual(s0.won, 10);
  assert.strictEqual(s1.won, 10);
  assert.strictEqual(s0.profit, 0);
  assert.strictEqual(s1.profit, 0);
  assert.strictEqual(s0.result, 'push');
});

// ── getPublicState 可见性 ─────────────────────────

test('行动中：仅 viewer 看到自己的 holeCards，其他玩家被遮', () => {
  const g = new Game({
    players: mkPlayers({ seatId: 0 }, { seatId: 1 }, { seatId: 2 }),
    dealerSeat: 0, smallBlind: 5, bigBlind: 10, handId: 'h4',
  });
  const snap = g.getPublicState(0);
  assert.strictEqual(snap.players.find(p => p.seatId === 0).holeCards.length, 2);
  assert.strictEqual(snap.players.find(p => p.seatId === 1).holeCards.length, 0);
  assert.strictEqual(snap.players.find(p => p.seatId === 2).holeCards.length, 0);
});
