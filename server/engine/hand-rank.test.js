const test = require('node:test');
const assert = require('node:assert');

const { evaluate5, evaluate7, compareScore, CATEGORY, combinations } = require('./hand-rank');

// 辅助：从字符串构造牌，'As' → 黑桃A
function p(...specs) {
  const suitMap = { s: '♠', h: '♥', d: '♦', c: '♣' };
  return specs.map(s => {
    const suit = suitMap[s.slice(-1)];
    const rank = s.slice(0, -1);
    return { rank, suit };
  });
}

test('combinations(7,5) 共 21 个', () => {
  assert.strictEqual(combinations(7, 5).length, 21);
});

test('evaluate5: 同花顺', () => {
  const r = evaluate5(p('9h','10h','Jh','Qh','Kh'));
  assert.strictEqual(r.category, CATEGORY.STRAIGHT_FLUSH);
  assert.strictEqual(r.tiebreakers[0], 13);
});

test('evaluate5: 皇家同花顺也按同花顺分类，顶牌 A=14', () => {
  const r = evaluate5(p('10s','Js','Qs','Ks','As'));
  assert.strictEqual(r.category, CATEGORY.STRAIGHT_FLUSH);
  assert.strictEqual(r.tiebreakers[0], 14);
});

test('evaluate5: 四条', () => {
  const r = evaluate5(p('7s','7h','7d','7c','2s'));
  assert.strictEqual(r.category, CATEGORY.FOUR_OF_A_KIND);
  assert.deepStrictEqual(r.tiebreakers, [7, 2]);
});

test('evaluate5: 葫芦', () => {
  const r = evaluate5(p('9s','9h','9d','4c','4s'));
  assert.strictEqual(r.category, CATEGORY.FULL_HOUSE);
  assert.deepStrictEqual(r.tiebreakers, [9, 4]);
});

test('evaluate5: 同花，按降序排列做 tiebreakers', () => {
  const r = evaluate5(p('2s','7s','9s','Js','Ks'));
  assert.strictEqual(r.category, CATEGORY.FLUSH);
  assert.deepStrictEqual(r.tiebreakers, [13, 11, 9, 7, 2]);
});

test('evaluate5: 顺子', () => {
  const r = evaluate5(p('5s','6h','7d','8c','9s'));
  assert.strictEqual(r.category, CATEGORY.STRAIGHT);
  assert.strictEqual(r.tiebreakers[0], 9);
});

test('evaluate5: wheel A-2-3-4-5 按 5 算', () => {
  const r = evaluate5(p('As','2h','3d','4c','5s'));
  assert.strictEqual(r.category, CATEGORY.STRAIGHT);
  assert.strictEqual(r.tiebreakers[0], 5);
});

test('evaluate5: 三条 + 两张 kicker', () => {
  const r = evaluate5(p('Qs','Qh','Qd','9c','3s'));
  assert.strictEqual(r.category, CATEGORY.THREE_OF_A_KIND);
  assert.deepStrictEqual(r.tiebreakers, [12, 9, 3]);
});

test('evaluate5: 两对', () => {
  const r = evaluate5(p('Ks','Kh','5d','5c','3s'));
  assert.strictEqual(r.category, CATEGORY.TWO_PAIR);
  assert.deepStrictEqual(r.tiebreakers, [13, 5, 3]);
});

test('evaluate5: 一对', () => {
  const r = evaluate5(p('Js','Jh','Kd','7c','3s'));
  assert.strictEqual(r.category, CATEGORY.ONE_PAIR);
  assert.deepStrictEqual(r.tiebreakers, [11, 13, 7, 3]);
});

test('evaluate5: 高牌', () => {
  const r = evaluate5(p('2s','5h','9d','Jc','As'));
  assert.strictEqual(r.category, CATEGORY.HIGH_CARD);
  assert.deepStrictEqual(r.tiebreakers, [14, 11, 9, 5, 2]);
});

test('evaluate7: 从 7 张中找到同花顺，盖过表面的四条', () => {
  // 7s 7h 7d 7c 5h 6h 8h —— 表面四条，实际 5h 6h 7h 8h 9h? 不，没有 9h
  // 真同花顺 case：4h 5h 6h 7h 8h + 任意两张
  const r = evaluate7(p('4h','5h','6h','7h','8h','As','2c'));
  assert.strictEqual(r.category, CATEGORY.STRAIGHT_FLUSH);
  assert.strictEqual(r.tiebreakers[0], 8);
});

test('evaluate7: 葫芦 vs 同花，葫芦胜', () => {
  // 红桃同花 + 三条 K + 一对 Q —— 实际最佳是 葫芦 K over Q
  const r = evaluate7(p('Ks','Kh','Kd','Qs','Qh','2h','5h'));
  assert.strictEqual(r.category, CATEGORY.FULL_HOUSE);
  assert.deepStrictEqual(r.tiebreakers, [13, 12]);
});

test('evaluate7: 选最佳 kicker', () => {
  // 一对 A + 三个其他点 → 一对 A，kicker 取最大的三个
  const r = evaluate7(p('As','Ah','Kd','9c','7h','3s','2s'));
  assert.strictEqual(r.category, CATEGORY.ONE_PAIR);
  assert.deepStrictEqual(r.tiebreakers, [14, 13, 9, 7]);
});

test('compareScore: 类别差异', () => {
  assert.ok(compareScore([9, 14], [8, 14, 14]) > 0, '同花顺 > 四条');
  assert.ok(compareScore([5, 9], [6, 9, 8, 7, 6, 5]) < 0, '顺子 < 同花');
});

test('compareScore: tiebreaker 决胜', () => {
  // 两个一对：A 对 K
  assert.ok(compareScore([2, 14, 13, 9, 7], [2, 13, 14, 9, 7]) > 0);
  // 完全平
  assert.strictEqual(compareScore([7, 13, 12], [7, 13, 12]), 0);
});
