const test = require('node:test');
const assert = require('node:assert');

const { computePots, distribute } = require('./pot');

test('单层主池：所有人投同额', () => {
  const pots = computePots([
    { id: 'A', totalBet: 100 },
    { id: 'B', totalBet: 100 },
    { id: 'C', totalBet: 100 },
  ]);
  assert.strictEqual(pots.length, 1);
  assert.deepStrictEqual(pots[0], { amount: 300, eligibleIds: ['A', 'B', 'C'] });
});

test('两层边池：A all-in 50，B/C 跟到 200', () => {
  const pots = computePots([
    { id: 'A', totalBet: 50 },
    { id: 'B', totalBet: 200 },
    { id: 'C', totalBet: 200 },
  ]);
  assert.strictEqual(pots.length, 2);
  // 主池 50*3 = 150，所有人有份
  assert.deepStrictEqual(pots[0], { amount: 150, eligibleIds: ['A', 'B', 'C'] });
  // 边池 150*2 = 300，只有 B/C
  assert.deepStrictEqual(pots[1], { amount: 300, eligibleIds: ['B', 'C'] });
});

test('弃牌玩家的钱进 pot 但他无资格', () => {
  const pots = computePots([
    { id: 'A', totalBet: 100, folded: true },
    { id: 'B', totalBet: 100 },
    { id: 'C', totalBet: 100 },
  ]);
  assert.strictEqual(pots.length, 1);
  assert.strictEqual(pots[0].amount, 300);
  assert.deepStrictEqual(pots[0].eligibleIds, ['B', 'C']);
});

test('未跟到的部分变成"只有本人有资格的 pot"', () => {
  // Alice 下 200，Bob 只跟到 50 然后 all-in；Alice 多出的 150 实际应还给她
  const pots = computePots([
    { id: 'A', totalBet: 200 },
    { id: 'B', totalBet: 50 },
  ]);
  assert.strictEqual(pots.length, 2);
  assert.deepStrictEqual(pots[0], { amount: 100, eligibleIds: ['A', 'B'] });
  assert.deepStrictEqual(pots[1], { amount: 150, eligibleIds: ['A'] });
});

test('三层 all-in', () => {
  const pots = computePots([
    { id: 'A', totalBet: 30 },
    { id: 'B', totalBet: 60 },
    { id: 'C', totalBet: 100 },
  ]);
  assert.strictEqual(pots.length, 3);
  assert.deepStrictEqual(pots[0], { amount: 30 * 3, eligibleIds: ['A', 'B', 'C'] });
  assert.deepStrictEqual(pots[1], { amount: 30 * 2, eligibleIds: ['B', 'C'] });
  assert.deepStrictEqual(pots[2], { amount: 40 * 1, eligibleIds: ['C'] });
});

test('distribute: 单赢家拿全', () => {
  const pots = [{ amount: 300, eligibleIds: ['A', 'B', 'C'] }];
  const got = distribute(pots, () => ['A']);
  assert.strictEqual(got.get('A'), 300);
  assert.strictEqual(got.size, 1);
});

test('distribute: 平分时余数从前依序加 1', () => {
  const pots = [{ amount: 301, eligibleIds: ['A', 'B'] }];
  const got = distribute(pots, () => ['A', 'B']);
  assert.strictEqual(got.get('A'), 151);  // 150 + 1
  assert.strictEqual(got.get('B'), 150);
});

test('distribute: 边池场景，主池 A 赢，边池 B 赢', () => {
  const pots = [
    { amount: 150, eligibleIds: ['A', 'B', 'C'] },
    { amount: 300, eligibleIds: ['B', 'C'] },
  ];
  const got = distribute(pots, (eligible) => {
    if (eligible.includes('A')) return ['A'];
    return ['B'];
  });
  assert.strictEqual(got.get('A'), 150);
  assert.strictEqual(got.get('B'), 300);
});
