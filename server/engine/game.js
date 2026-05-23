/**
 * 一手牌的完整生命周期
 *
 * 用法：
 *   const game = new Game({ players, dealerSeat, smallBlind, bigBlind, handId, deck });
 *   const evt  = game.act(seatId, { type: 'call' });   // 返回 'continue' | 'round_end' | 'hand_end'
 *   const snapshot = game.getPublicState(viewerSeatId);// 给某座位看的快照（hole cards 仅自己可见，结束后所有人可见）
 *
 * V1 简化：
 *   - all-in 小于 minRaise 不重新打开行动（保留更严格规则到 V2）
 *   - 不做"未跟注金额自动返还动画"——逻辑上 pot 切分时 eligible 仅本人，效果等价
 *
 * 玩家状态：
 *   'active' 还能行动
 *   'folded' 弃牌
 *   'allin'  筹码归零但仍参与摊牌
 */
const { createShuffledDeck, deal } = require('./deck');
const { evaluate7, compareScore, evaluate5, combinations, CATEGORY, CATEGORY_NAME } = require('./hand-rank');
const { computePots, distribute } = require('./pot');

const PHASES_IN_ORDER = ['preflop', 'flop', 'turn', 'river', 'showdown'];

class Game {
  constructor({ players, dealerSeat, smallBlind, bigBlind, handId, deck }) {
    if (!Array.isArray(players) || players.length < 2) {
      throw new Error('至少 2 人才能开始一手');
    }

    this.handId     = handId;
    this.smallBlind = smallBlind;
    this.bigBlind   = bigBlind;
    this.dealerSeat = dealerSeat;
    this.deck       = deck || createShuffledDeck();
    this.communityCards = [];

    this.players = players.map(p => ({
      id:        p.id,
      seatId:    p.seatId,
      username:  p.username,
      chipsStart: p.chips,
      chips:     p.chips,
      holeCards: [],
      status:    'active',
      totalBet:  0,
      currentBet: 0,
      hasActedThisRound: false,
      isRaiseLocked: false,
    }));

    if (!this.players.some(p => p.seatId === dealerSeat)) {
      throw new Error(`dealerSeat ${dealerSeat} 不在玩家列表中`);
    }

    this.phase      = 'preflop';
    this.currentBet = 0;
    this.minRaise   = this.bigBlind;
    this.actionLog  = [];
    this.results    = null;

    this._dealHoleCards();
    this._postBlinds();
    this._setFirstToActPreflop();

    // 如果可下注的活跃玩家少于等于 1 个，直接发牌进入摊牌
    const active = this.players.filter(p => p.status === 'active');
    if (active.length <= 1) {
      this._runOutAndShowdown();
    }
  }

  // ── 工具 ──────────────────────────────────────────

  _sortedSeats() {
    return this.players.map(p => p.seatId).sort((a, b) => a - b);
  }

  /** 从 fromSeat 之后顺时针绕一圈的座位列表，最后一个是 fromSeat 自己 */
  _seatsAfter(fromSeat) {
    const seats = this._sortedSeats();
    const idx = seats.indexOf(fromSeat);
    if (idx < 0) return seats;
    return [...seats.slice(idx + 1), ...seats.slice(0, idx + 1)];
  }

  _playerBySeat(seatId) {
    return this.players.find(p => p.seatId === seatId);
  }

  _nextActiveFrom(seatId, inclusive = false) {
    const seats = this._sortedSeats();
    const idx = seats.indexOf(seatId);
    if (idx < 0) return seatId;
    const start = inclusive ? idx : idx + 1;
    for (let step = 0; step < seats.length; step++) {
      const i = (start + step) % seats.length;
      const p = this._playerBySeat(seats[i]);
      if (p && p.status === 'active') return seats[i];
    }
    return seatId;
  }

  // ── 初始化 ────────────────────────────────────────

  _dealHoleCards() {
    // 从庄家下家开始，发两轮，每人 2 张
    const order = this._seatsAfter(this.dealerSeat);
    for (let round = 0; round < 2; round++) {
      for (const seat of order) {
        const p = this._playerBySeat(seat);
        p.holeCards.push(deal(this.deck, 1)[0]);
      }
    }
  }

  _postBlinds() {
    const order = this._seatsAfter(this.dealerSeat);
    let sbSeat, bbSeat;
    if (this.players.length === 2) {
      // heads-up：庄家发 SB，对手发 BB
      sbSeat = this.dealerSeat;
      bbSeat = order[0];

      const sbPlayer = this._playerBySeat(sbSeat);
      const bbPlayer = this._playerBySeat(bbSeat);
      const maxBlind = Math.min(sbPlayer.chips, bbPlayer.chips);

      if (maxBlind < this.bigBlind) {
        // 筹码不足，同比例削减盲注
        const effectiveBB = maxBlind;
        const effectiveSB = Math.min(this.smallBlind, Math.ceil(effectiveBB / 2));

        this._forceBet(sbSeat, effectiveSB);
        this._forceBet(bbSeat, effectiveBB);
        this.currentBet = effectiveBB;
        this.minRaise   = effectiveBB;
      } else {
        this._forceBet(sbSeat, this.smallBlind);
        this._forceBet(bbSeat, this.bigBlind);
        this.currentBet = this.bigBlind;
        this.minRaise   = this.bigBlind;
      }
    } else {
      sbSeat = order[0];
      bbSeat = order[1];
      this._forceBet(sbSeat, this.smallBlind);
      this._forceBet(bbSeat, this.bigBlind);
      this.currentBet = this.bigBlind;
      this.minRaise   = this.bigBlind;
    }
    this._sbSeat = sbSeat;
    this._bbSeat = bbSeat;
  }

  _forceBet(seatId, amount) {
    const p = this._playerBySeat(seatId);
    const pay = Math.min(amount, p.chips);
    p.chips      -= pay;
    p.totalBet   += pay;
    p.currentBet += pay;
    if (p.chips === 0) p.status = 'allin';
  }

  _setFirstToActPreflop() {
    let firstSeat;
    if (this.players.length === 2) {
      firstSeat = this._sbSeat;  // heads-up: SB 先
    } else {
      firstSeat = this._seatsAfter(this._bbSeat)[0]; // UTG = BB 下家
    }
    this.currentSeat = this._nextActiveFrom(firstSeat, /* inclusive */ true);
  }

  _setFirstToActPostflop() {
    // 翻后：庄家下家先；2 人时即 BB
    const firstSeat = this._seatsAfter(this.dealerSeat)[0];
    this.currentSeat = this._nextActiveFrom(firstSeat, /* inclusive */ true);
  }

  // ── 行动 ──────────────────────────────────────────

  /**
   * @returns {{type: 'continue'|'round_end'|'hand_end', ...}} 事件
   */
  act(seatId, action) {
    if (this.phase === 'ended') throw new Error('本手已结束');
    if (seatId !== this.currentSeat) {
      throw new Error(`不是 seat ${seatId} 的回合（当前 ${this.currentSeat}）`);
    }
    const p = this._playerBySeat(seatId);
    if (!p || p.status !== 'active') {
      throw new Error('该玩家无法行动');
    }

    let logEntry;
    switch (action.type) {
      case 'fold':
        p.status = 'folded';
        logEntry = { seatId, type: 'fold' };
        break;

      case 'check':
        if (p.currentBet < this.currentBet) throw new Error('当前需要跟注，不能过牌');
        p.isRaiseLocked = true;
        logEntry = { seatId, type: 'check' };
        break;

      case 'call': {
        const need = this.currentBet - p.currentBet;
        if (need <= 0) throw new Error('无需跟注，请用 check');
        const pay = Math.min(need, p.chips);
        p.chips      -= pay;
        p.totalBet   += pay;
        p.currentBet += pay;
        if (p.chips === 0) p.status = 'allin';
        p.isRaiseLocked = true;
        logEntry = { seatId, type: 'call', amount: pay };
        break;
      }

      case 'raise': {
        if (p.isRaiseLocked) {
          throw new Error('当前行动未被重新打开，不能加注');
        }
        // action.amount = 加注到的"本街投入"目标
        const target = action.amount;
        if (!Number.isInteger(target) || target <= this.currentBet) {
          throw new Error(`加注额 ${target} 必须大于当前 ${this.currentBet}`);
        }
        const need = target - p.currentBet;
        if (need > p.chips) {
          throw new Error('筹码不足，请用 call 形成 all-in');
        }
        const increase = target - this.currentBet;
        // 严格 minRaise：除非用完所有筹码（all-in raise 允许小于 minRaise）
        if (increase < this.minRaise && need < p.chips) {
          throw new Error(`加注增量至少 ${this.minRaise}`);
        }
        p.chips     -= need;
        p.totalBet  += need;
        p.currentBet = target;
        this.currentBet = target;

        const isCompleteRaise = increase >= this.minRaise;
        if (isCompleteRaise) {
          this.minRaise = increase;
          // 重新打开所有其他 active 玩家的行动，并解除他们的 raise-lock
          for (const o of this.players) {
            if (o.seatId !== p.seatId && o.status === 'active') {
              o.hasActedThisRound = false;
              o.isRaiseLocked = false;
            }
          }
        }
        p.isRaiseLocked = true;
        if (p.chips === 0) p.status = 'allin';
        logEntry = { seatId, type: 'raise', amount: target, increase };
        break;
      }

      default:
        throw new Error(`未知行动 ${action.type}`);
    }

    p.hasActedThisRound = true;
    this.actionLog.push({ phase: this.phase, ...logEntry });

    return this._afterAction();
  }

  _afterAction() {
    // 只剩 1 个 non-folded → 弃牌胜出
    const nonFolded = this.players.filter(p => p.status !== 'folded');
    if (nonFolded.length === 1) return this._finishByFold(nonFolded[0]);

    if (this._isRoundComplete()) {
      // 没人能继续下注（≤1 active）→ 一路开到摊牌
      const canBet = this.players.filter(p => p.status === 'active');
      if (canBet.length <= 1) return this._runOutAndShowdown();
      return this._advancePhase();
    }

    this.currentSeat = this._nextActiveFrom(this.currentSeat);
    return { type: 'continue', currentSeat: this.currentSeat };
  }

  _isRoundComplete() {
    const active = this.players.filter(p => p.status === 'active');
    if (active.length === 0) return true;
    return active.every(p => p.hasActedThisRound && p.currentBet === this.currentBet);
  }

  _advancePhase() {
    // 清算本街：currentBet 归零，重置 hasActedThisRound 与 isRaiseLocked
    for (const p of this.players) {
      p.currentBet = 0;
      if (p.status === 'active') {
        p.hasActedThisRound = false;
        p.isRaiseLocked = false;
      }
    }
    this.currentBet = 0;
    this.minRaise   = this.bigBlind;

    const idx = PHASES_IN_ORDER.indexOf(this.phase);
    this.phase = PHASES_IN_ORDER[idx + 1];

    if (this.phase === 'flop'  && this.communityCards.length < 3) this.communityCards.push(...deal(this.deck, 3));
    if (this.phase === 'turn'  && this.communityCards.length < 4) this.communityCards.push(...deal(this.deck, 1));
    if (this.phase === 'river' && this.communityCards.length < 5) this.communityCards.push(...deal(this.deck, 1));

    if (this.phase === 'showdown') return this._showdown();

    this._setFirstToActPostflop();
    return {
      type: 'round_end',
      phase: this.phase,
      communityCards: this.communityCards.slice(),
      currentSeat: this.currentSeat,
    };
  }

  _runOutAndShowdown() {
    while (this.phase !== 'showdown') {
      const idx = PHASES_IN_ORDER.indexOf(this.phase);
      this.phase = PHASES_IN_ORDER[idx + 1];
      if (this.phase === 'flop'  && this.communityCards.length < 3) this.communityCards.push(...deal(this.deck, 3));
      if (this.phase === 'turn'  && this.communityCards.length < 4) this.communityCards.push(...deal(this.deck, 1));
      if (this.phase === 'river' && this.communityCards.length < 5) this.communityCards.push(...deal(this.deck, 1));
    }
    return this._showdown();
  }

  // ── 结算 ──────────────────────────────────────────

  _buildContributors() {
    return this.players.map(p => ({
      id:       p.seatId,
      totalBet: p.totalBet,
      folded:   p.status === 'folded',
    }));
  }

  _finalize(reason, hands /* Map<seatId, evalResult> */, payouts /* Map<seatId, won> */, pots) {
    // 加上奖金并清空临时下注
    for (const [seatId, won] of payouts.entries()) {
      this._playerBySeat(seatId).chips += won;
    }
    for (const p of this.players) {
      p.currentBet = 0;
    }
    this.currentBet = 0;

    // 生成 summary
    const summary = this.players.map(p => {
      const won  = payouts.get(p.seatId) || 0;
      const paid = p.totalBet;
      const profit = won - paid;
      let result;
      if (profit > 0) result = 'win';
      else if (profit < 0) result = 'loss';
      else result = 'push';
      const h = hands.get(p.seatId);
      return {
        seatId:    p.seatId,
        username:  p.username,
        won, paid, profit,
        chipsAfter: p.chips,
        result,
        category:     h ? h.category : null,
        categoryName: h ? h.categoryName : null,
      };
    });
    this.results = {
      reason,
      pots,
      communityCards: this.communityCards.slice(),
      hands: Object.fromEntries(
        Array.from(hands.entries()).map(([k, v]) => [k, {
          category: v.category, categoryName: v.categoryName, cards: v.cards,
        }])
      ),
      summary,
    };
    this.phase = 'ended';
    return { type: 'hand_end', reason, results: this.results };
  }

  _showdown() {
    const contenders = this.players.filter(p => p.status !== 'folded');
    const hands = new Map();
    for (const p of contenders) {
      const seven = [...p.holeCards, ...this.communityCards];
      hands.set(p.seatId, evaluate7(seven));
    }
    const order = this._seatsAfter(this.dealerSeat);
    const pots = computePots(this._buildContributors());
    const payouts = distribute(pots, (eligibleIds) => {
      let best = null;
      let winners = [];
      for (const id of eligibleIds) {
        const r = hands.get(id);
        if (!r) continue;
        if (!best || compareScore(r.score, best) > 0) {
          best = r.score; winners = [id];
        } else if (compareScore(r.score, best) === 0) {
          winners.push(id);
        }
      }
      winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return winners;
    });
    return this._finalize('showdown', hands, payouts, pots);
  }

  _finishByFold(lastStanding) {
    const pots = computePots(this._buildContributors());
    const payouts = distribute(pots, (eligibleIds) => {
      if (eligibleIds.length === 1) return eligibleIds;
      return [lastStanding.seatId];
    });
    return this._finalize('fold', new Map(), payouts, pots);
  }

  // ── 视图 ──────────────────────────────────────────

  /**
   * GameState 快照
   * @param viewerSeatId 看自己 holeCards；null = 不显示任何 hole（除非本手已结束摊牌）
   */
  getPublicState(viewerSeatId = null) {
    const pot = this.players.reduce((s, p) => s + p.totalBet, 0);
    const isShowdown = this.phase === 'ended' && this.results && this.results.reason === 'showdown';

    // 实时计算该 viewer 当前的最佳组合牌型名称
    let heroHandType = null;
    if (viewerSeatId !== null && viewerSeatId !== undefined) {
      const viewerPlayer = this._playerBySeat(viewerSeatId);
      if (viewerPlayer && viewerPlayer.status !== 'folded' && viewerPlayer.holeCards?.length === 2 && this.communityCards.length >= 3) {
        try {
          const combined = [...viewerPlayer.holeCards, ...this.communityCards];
          let bestEval = null;
          for (const idxs of combinations(combined.length, 5)) {
            const sub = idxs.map(i => combined[i]);
            const r = evaluate5(sub);
            if (!bestEval || compareScore([r.category, ...r.tiebreakers], [bestEval.category, ...bestEval.tiebreakers]) > 0) {
              bestEval = r;
            }
          }
          const isRoyal = bestEval.category === CATEGORY.STRAIGHT_FLUSH && bestEval.tiebreakers[0] === 14;
          heroHandType = isRoyal ? '皇家同花顺' : CATEGORY_NAME[bestEval.category];
        } catch (e) {
          console.error('[Game] 实时牌型分析失败:', e);
        }
      }
    }

    return {
      handId:         this.handId,
      phase:          this.phase,
      pot,
      communityCards: this.communityCards.slice(),
      currentSeat:    this.currentSeat,
      currentBet:     this.currentBet,
      minRaise:       this.minRaise,
      smallBlind:     this.smallBlind,
      bigBlind:       this.bigBlind,
      dealerSeat:     this.dealerSeat,
      heroHandType,  // 塞给前端渲染！
      results:        this.phase === 'ended' ? this.results : null,
      players: this.players.map(p => ({
        seatId:    p.seatId,
        username:  p.username,
        chips:     p.chips,
        status:    p.status,
        bet:       p.currentBet,
        totalBet:  p.totalBet,
        isDealer:  p.seatId === this.dealerSeat,
        holeCards: (viewerSeatId === p.seatId || isShowdown) ? p.holeCards.slice() : [],
      })),
    };
  }
}

module.exports = { Game };
