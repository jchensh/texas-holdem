/**
 * 边池切分
 *
 * 输入：每个玩家在这一手中累计投入和是否弃牌
 * 输出：按 all-in 层级切出的若干 pot，每个标注谁有资格争夺
 *
 * 规则提醒：
 * - 弃牌玩家的筹码仍贡献给奖池（他不能赢回去）
 * - 主池由所有还没弃牌的玩家争夺；如果有人 all-in 金额小于其他人，他只参与到 all-in 额度的那一层
 * - 未被跟注的部分（uncalled bet）实际上变成"只有原玩家自己有资格的 pot"，最终会还给他
 */

/**
 * 计算边池
 * @param {Array<{id, totalBet, folded}>} contributors
 * @returns {Array<{ amount, eligibleIds }>}
 *   按 all-in 层级从小到大，每层的累计金额 + 有资格争夺的玩家 id 列表
 */
function computePots(contributors) {
  const pots = [];

  // 只考虑出过钱的人；克隆一份做衰减
  let remaining = contributors
    .filter(c => c.totalBet > 0)
    .map(c => ({ id: c.id, remaining: c.totalBet, folded: !!c.folded }));

  while (remaining.length > 0) {
    // 当前最小投入额度 = 这一层的高度
    const level = Math.min(...remaining.map(c => c.remaining));
    // 每个剩余玩家在这一层贡献 level，pot 总额 = level * 人数
    const amount = level * remaining.length;
    const eligibleIds = remaining.filter(c => !c.folded).map(c => c.id);

    if (eligibleIds.length > 0) {
      pots.push({ amount, eligibleIds });
    } else {
      // 罕见：所有 contributor 都已弃牌（理论上不会发生，因为最后一个不弃牌的人会直接拿走全部）
      // 兜底：并入上一个 pot
      if (pots.length > 0) {
        pots[pots.length - 1].amount += amount;
      } else {
        pots.push({ amount, eligibleIds: [] });
      }
    }

    // 每人扣掉 level，剔除清零的人
    remaining = remaining
      .map(c => ({ ...c, remaining: c.remaining - level }))
      .filter(c => c.remaining > 0);
  }

  return pots;
}

/**
 * 按边池分配筹码给赢家
 * @param {Array<{amount, eligibleIds}>} pots
 * @param {(eligibleIds: string[]) => string[]} pickWinners
 *        在 eligible 中挑出赢家 id 列表（可能多人平分）
 * @returns {Map<id, chips>} 每位玩家本手净到手筹码
 */
function distribute(pots, pickWinners) {
  const result = new Map();
  for (const pot of pots) {
    if (pot.amount <= 0 || pot.eligibleIds.length === 0) continue;
    const winners = pickWinners(pot.eligibleIds);
    if (winners.length === 0) continue;
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;
    winners.forEach((id, i) => {
      // 余数从第一个赢家开始派发（避免分钱不平整时凭空消失）
      const got = share + (i < remainder ? 1 : 0);
      result.set(id, (result.get(id) || 0) + got);
    });
  }
  return result;
}

module.exports = { computePots, distribute };
