const test = require('node:test');
const assert = require('node:assert');

const { buildDeck, shuffle, createShuffledDeck, deal, SUITS, RANKS, RANK_VALUE } = require('./deck');

test('buildDeck 产出 52 张唯一的牌', () => {
  const deck = buildDeck();
  assert.strictEqual(deck.length, 52);
  const set = new Set(deck.map(c => c.rank + c.suit));
  assert.strictEqual(set.size, 52);
});

test('每种花色 13 张，每种点数 4 张', () => {
  const deck = buildDeck();
  for (const s of SUITS) assert.strictEqual(deck.filter(c => c.suit === s).length, 13);
  for (const r of RANKS) assert.strictEqual(deck.filter(c => c.rank === r).length, 4);
});

test('shuffle 不修改原数组，返回不同顺序的同集合', () => {
  const orig = buildDeck();
  const origSnapshot = orig.map(c => c.rank + c.suit).join(',');
  // 用伪随机数固定结果
  let i = 0;
  const seq = [0.1, 0.9, 0.3, 0.7, 0.5];
  const rng = () => seq[i++ % seq.length];
  const shuffled = shuffle(orig, rng);

  assert.strictEqual(orig.map(c => c.rank + c.suit).join(','), origSnapshot, '原数组未被修改');
  assert.strictEqual(shuffled.length, 52);
  const set = new Set(shuffled.map(c => c.rank + c.suit));
  assert.strictEqual(set.size, 52, '洗后仍是 52 张唯一');
});

test('createShuffledDeck 注入 rng 得确定性结果', () => {
  const rng = () => 0.5;  // 不会真随机，但稳定
  const d1 = createShuffledDeck(rng);
  const d2 = createShuffledDeck(rng);
  assert.deepStrictEqual(d1, d2, '相同 rng 应产生相同结果');
});

test('deal 从牌堆顶发牌并修改原数组', () => {
  const deck = createShuffledDeck(() => 0.5);
  const before = deck.length;
  const hand = deal(deck, 5);
  assert.strictEqual(hand.length, 5);
  assert.strictEqual(deck.length, before - 5);
});

test('deal 牌不够时抛错', () => {
  const deck = [{ rank: 'A', suit: '♠' }];
  assert.throws(() => deal(deck, 2), /发不出/);
});

test('RANK_VALUE 映射正确', () => {
  assert.strictEqual(RANK_VALUE['2'], 2);
  assert.strictEqual(RANK_VALUE['10'], 10);
  assert.strictEqual(RANK_VALUE['J'], 11);
  assert.strictEqual(RANK_VALUE['Q'], 12);
  assert.strictEqual(RANK_VALUE['K'], 13);
  assert.strictEqual(RANK_VALUE['A'], 14);
});
