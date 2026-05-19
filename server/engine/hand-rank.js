/**
 * 德州扑克 7 选 5 牌力评估
 *
 * 给定 7 张牌（2 手牌 + 5 公共牌），找出最佳 5 张组合，并产出可比较的 score。
 *
 * Score 结构：[category, ...tiebreakers]
 *   - category 越大牌越大
 *   - 同 category 时按 tiebreakers 字典序比较
 *
 * Category 编码（从大到小）：
 *   9 同花顺   straight_flush
 *   8 四条     four_of_a_kind
 *   7 葫芦     full_house
 *   6 同花     flush
 *   5 顺子     straight
 *   4 三条     three_of_a_kind
 *   3 两对     two_pair
 *   2 一对     one_pair
 *   1 高牌     high_card
 */
const { RANK_VALUE } = require('./deck');

const CATEGORY = {
  STRAIGHT_FLUSH:  9,
  FOUR_OF_A_KIND:  8,
  FULL_HOUSE:      7,
  FLUSH:           6,
  STRAIGHT:        5,
  THREE_OF_A_KIND: 4,
  TWO_PAIR:        3,
  ONE_PAIR:        2,
  HIGH_CARD:       1,
};

const CATEGORY_NAME = {
  9: '同花顺', 8: '四条', 7: '葫芦', 6: '同花',
  5: '顺子',   4: '三条', 3: '两对', 2: '一对', 1: '高牌',
};

/** 从 n 个元素中选 k 个的所有组合，返回索引数组的数组 */
function combinations(n, k) {
  const out = [];
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    out.push(idx.slice());
    // 找到最右侧可以右移的位置
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

/** 检测顺子；输入 5 个 *降序* 不同 rank 数值。返回顶牌值或 0（非顺子） */
function detectStraight(sortedDescValues) {
  const v = sortedDescValues;
  if (v.length !== 5) return 0;
  // 普通顺：连续递减 1
  let isStraight = true;
  for (let i = 1; i < 5; i++) {
    if (v[i] !== v[i - 1] - 1) { isStraight = false; break; }
  }
  if (isStraight) return v[0];
  // Wheel: A-2-3-4-5 即 [14,5,4,3,2]
  if (v[0] === 14 && v[1] === 5 && v[2] === 4 && v[3] === 3 && v[4] === 2) {
    return 5; // wheel 顶牌按 5 算
  }
  return 0;
}

/**
 * 评估恰好 5 张牌的组合
 * @returns { category, tiebreakers, cards }
 */
function evaluate5(cards) {
  if (cards.length !== 5) throw new Error('evaluate5 需要恰好 5 张牌');
  const values = cards.map(c => RANK_VALUE[c.rank]).sort((a, b) => b - a); // 降序
  const suits  = cards.map(c => c.suit);

  // 同花？
  const isFlush = suits.every(s => s === suits[0]);

  // 顺子？(用去重后的降序值，刚好 5 张所以一般也是 5 个不同；除非有对子)
  const uniqDesc = Array.from(new Set(values)).sort((a, b) => b - a);
  const straightTop = uniqDesc.length === 5 ? detectStraight(uniqDesc) : 0;

  if (isFlush && straightTop) {
    return { category: CATEGORY.STRAIGHT_FLUSH, tiebreakers: [straightTop], cards };
  }

  // 点数频率：rank -> count
  const freq = new Map();
  for (const v of values) freq.set(v, (freq.get(v) || 0) + 1);
  // 按 [count desc, rank desc] 排序的 entries
  const grouped = Array.from(freq.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const counts = grouped.map(g => g[1]);   // e.g. [4,1] / [3,2] / [3,1,1] / [2,2,1] / [2,1,1,1] / [1,1,1,1,1]
  const ranks  = grouped.map(g => g[0]);

  // 四条
  if (counts[0] === 4) {
    return { category: CATEGORY.FOUR_OF_A_KIND, tiebreakers: [ranks[0], ranks[1]], cards };
  }
  // 葫芦
  if (counts[0] === 3 && counts[1] === 2) {
    return { category: CATEGORY.FULL_HOUSE, tiebreakers: [ranks[0], ranks[1]], cards };
  }
  // 同花
  if (isFlush) {
    return { category: CATEGORY.FLUSH, tiebreakers: values, cards };
  }
  // 顺子
  if (straightTop) {
    return { category: CATEGORY.STRAIGHT, tiebreakers: [straightTop], cards };
  }
  // 三条
  if (counts[0] === 3) {
    return { category: CATEGORY.THREE_OF_A_KIND, tiebreakers: [ranks[0], ranks[1], ranks[2]], cards };
  }
  // 两对
  if (counts[0] === 2 && counts[1] === 2) {
    return { category: CATEGORY.TWO_PAIR, tiebreakers: [ranks[0], ranks[1], ranks[2]], cards };
  }
  // 一对
  if (counts[0] === 2) {
    return { category: CATEGORY.ONE_PAIR, tiebreakers: [ranks[0], ranks[1], ranks[2], ranks[3]], cards };
  }
  // 高牌
  return { category: CATEGORY.HIGH_CARD, tiebreakers: values, cards };
}

/**
 * 评估 7 张牌中最好的 5 张组合
 * @returns { category, categoryName, tiebreakers, cards, score }
 *   score = [category, ...tiebreakers]，便于直接 compareScore
 */
function evaluate7(cards) {
  if (cards.length !== 7) throw new Error('evaluate7 需要恰好 7 张牌');
  let best = null;
  for (const idxs of combinations(7, 5)) {
    const sub = idxs.map(i => cards[i]);
    const r = evaluate5(sub);
    if (!best || compareScore([r.category, ...r.tiebreakers], [best.category, ...best.tiebreakers]) > 0) {
      best = r;
    }
  }
  return {
    category:     best.category,
    categoryName: CATEGORY_NAME[best.category],
    tiebreakers:  best.tiebreakers,
    cards:        best.cards,
    score:        [best.category, ...best.tiebreakers],
  };
}

/**
 * 比较两个 score 数组
 * @returns >0 a 强；<0 b 强；0 完全平
 */
function compareScore(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

module.exports = {
  CATEGORY, CATEGORY_NAME,
  evaluate5, evaluate7, compareScore,
  combinations, detectStraight, // 暴露给测试
};
