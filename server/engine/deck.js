/**
 * 牌堆 / 洗牌 / 发牌
 *
 * 牌的内部表示：{ rank: '2'..'10','J','Q','K','A', suit: '♠'|'♥'|'♦'|'♣' }
 * —— 与前端 _cardInnerHTML 的约定保持一致，可直接序列化下发。
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** 数值化 rank，A=14（高）；wheel A-2-3-4-5 单独处理 */
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2])); // '2' → 2 ... 'A' → 14

/** 构造未洗的 52 张牌 */
function buildDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push({ rank: r, suit: s });
  }
  return deck;
}

/**
 * Fisher–Yates 洗牌；rng 可注入便于测试
 * 不修改原数组，返回新数组
 */
function shuffle(deck, rng = Math.random) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 一步到位：构造 + 洗 */
function createShuffledDeck(rng = Math.random) {
  return shuffle(buildDeck(), rng);
}

/**
 * 从牌堆顶发 n 张牌；mutates deck（pop）
 * 返回长度为 n 的数组
 */
function deal(deck, n) {
  if (deck.length < n) throw new Error(`牌堆只剩 ${deck.length} 张，发不出 ${n} 张`);
  const out = [];
  for (let i = 0; i < n; i++) out.push(deck.pop());
  return out;
}

module.exports = {
  SUITS, RANKS, RANK_VALUE,
  buildDeck, shuffle, createShuffledDeck, deal,
};
