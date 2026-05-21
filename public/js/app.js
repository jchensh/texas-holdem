/**
 * 主应用逻辑
 *
 * App.updateGameState(state) 是后端数据的主入口。
 * state 结构参考：
 * {
 *   phase: 'preflop'|'flop'|'turn'|'river'|'showdown',
 *   pot: number,
 *   communityCards: [{ rank, suit }],   // 长度 0-5
 *   players: [
 *     {
 *       seatId: 0-5,     // 0 = 本人
 *       username: string,
 *       chips: number,
 *       bet: number,
 *       status: 'waiting'|'acting'|'folded'|'allin'|'winner',
 *       isDealer: boolean,
 *       holeCards: [{ rank, suit }],   // 本人可见；对手仅摊牌时显示
 *     }
 *   ]
 * }
 */

const App = {

  state: {
    user: null,       // { username, chips }
    game: null,       // 最新 GameState
  },

  // ── 启动 ──────────────────────────────────────────

  async init() {
    this._bindAuthEvents();
    this._bindGameEvents();
    this._bindHistoryEvents();
    this._bindRaiseSlider();

    // 尝试用 cookie session 恢复登录态；失败就停在 auth 视图
    try {
      const { user } = await this._apiGet('/api/me');
      this._onLoginSuccess(user);
    } catch {
      this._showView('auth');
    }
  },

  // ── HTTP API 辅助 ─────────────────────────────────

  async _apiPost(path, body) {
    const res = await fetch(path, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body:        body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `请求失败 (${res.status})`);
    return data;
  },

  async _apiGet(path) {
    const res = await fetch(path, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `请求失败 (${res.status})`);
    return data;
  },

  // ── 视图切换 ──────────────────────────────────────

  _showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
  },

  // ── 认证 ──────────────────────────────────────────

  _bindAuthEvents() {
    // 登录/注册标签切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`form-${tab}`).classList.add('active');
      });
    });

    document.getElementById('form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';

      try {
        const { user } = await this._apiPost('/api/login', { username, password });
        this._onLoginSuccess(user);
      } catch (err) {
        errEl.textContent = err.message || '登录失败';
      }
    });

    document.getElementById('form-register').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('reg-username').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirm  = document.getElementById('reg-confirm').value;
      const errEl = document.getElementById('register-error');
      errEl.textContent = '';

      // 客户端预校验（后端会再校一次，但这里能立即反馈）
      if (username.length < 3) { errEl.textContent = '用户名至少3个字符'; return; }
      if (password.length < 6) { errEl.textContent = '密码至少6位'; return; }
      if (password !== confirm) { errEl.textContent = '两次密码不一致'; return; }

      try {
        const { user } = await this._apiPost('/api/register', { username, password });
        this._onLoginSuccess(user);
      } catch (err) {
        errEl.textContent = err.message || '注册失败';
      }
    });
  },

  _onLoginSuccess(user) {
    this.state.user = user;
    // 同步 UI
    document.getElementById('header-username').textContent = user.username;
    document.getElementById('header-chips').textContent   = user.chips;
    document.getElementById('hero-initials').textContent  = user.username.charAt(0).toUpperCase();
    document.getElementById('hero-name').textContent      = user.username;
    document.getElementById('hero-chips').textContent     = user.chips;
    document.getElementById('history-chips').textContent  = user.chips;

    this._showView('game');
    // 重置大厅，等服务端 lobby_state 广播过来填真实列表
    document.getElementById('lobby-players').innerHTML = '';
    this._updateLobbyCount(0);
    this._showLobby();
    // session cookie 同源握手时浏览器自动带上
    SocketClient.connect();
  },

  // ── 大厅蒙层 / 等待角标 ───────────────────────────

  _showLobby() {
    document.getElementById('lobby-overlay').style.display = 'flex';
    document.getElementById('waiting-indicator').hidden = true;
  },

  _hideLobby() {
    document.getElementById('lobby-overlay').style.display = 'none';
    // 游戏还没开始就显示角标；已开局则两个都不显示
    if (!this.state.game) {
      document.getElementById('waiting-indicator').hidden = false;
    }
  },

  _updateLobbyCount(n) {
    document.getElementById('lobby-count').textContent = String(n);
    document.getElementById('waiting-count').textContent = `${n} / 6`;
  },

  // ── 游戏内事件 ────────────────────────────────────

  _bindGameEvents() {
    document.getElementById('btn-logout').addEventListener('click', async () => {
      // 失败也无所谓——客户端无论如何要切回 auth
      try { await this._apiPost('/api/logout'); } catch {}
      SocketClient.disconnect();
      this.state.user = null;
      this.state.game = null;
      // 清空登录态残留
      document.getElementById('login-password').value = '';
      document.getElementById('reg-password').value   = '';
      document.getElementById('reg-confirm').value    = '';
      document.getElementById('login-error').textContent    = '';
      document.getElementById('register-error').textContent = '';
      this._showView('auth');
    });

    document.getElementById('btn-show-history').addEventListener('click', () => {
      this._loadHistory();
      this._showView('history');
    });

    // 大厅蒙层的关闭按钮 + 角标点击切换
    document.getElementById('lobby-close')      .addEventListener('click', () => this._hideLobby());
    document.getElementById('lobby-dismiss')    .addEventListener('click', () => this._hideLobby());
    document.getElementById('waiting-indicator').addEventListener('click', () => this._showLobby());

    document.getElementById('btn-fold').addEventListener('click', () => {
      SocketClient.emit.fold();
      this.hideActionPanel();
    });

    document.getElementById('btn-check').addEventListener('click', () => {
      SocketClient.emit.check();
      this.hideActionPanel();
    });

    document.getElementById('btn-call').addEventListener('click', () => {
      SocketClient.emit.call();
      this.hideActionPanel();
    });

    document.getElementById('btn-raise').addEventListener('click', () => {
      const amount = parseInt(document.getElementById('raise-slider').value, 10);
      SocketClient.emit.raise(amount);
      this.hideActionPanel();
    });
  },

  _bindRaiseSlider() {
    document.getElementById('raise-slider').addEventListener('input', (e) => {
      document.getElementById('raise-display').textContent = e.target.value;
    });
  },

  // ── 历史记录 ──────────────────────────────────────

  _bindHistoryEvents() {
    document.getElementById('btn-back-game').addEventListener('click', () => {
      this._showView('game');
    });
  },

  async _loadHistory() {
    try {
      const res = await this._apiGet('/api/history');
      const hands = res.history || [];
      this._renderHistory(hands);
    } catch (err) {
      console.error('加载历史失败', err);
    }
  },

  _renderHistory(hands) {
    const wins    = hands.filter(h => h.result === 'win').length;
    const totalPnl = hands.reduce((s, h) => s + h.profit, 0);

    document.getElementById('history-count').textContent   = hands.length;
    document.getElementById('history-winrate').textContent =
      hands.length ? Math.round(wins / hands.length * 100) + '%' : '0%';

    const pnlEl = document.getElementById('history-pnl');
    pnlEl.textContent = (totalPnl >= 0 ? '+' : '') + totalPnl;
    pnlEl.className   = 'stat-value ' + (totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : '');

    // 更新当前筹码数显示
    document.getElementById('history-chips').textContent = this.state.user?.chips ?? 0;

    const list = document.getElementById('history-list');
    if (!hands.length) {
      list.innerHTML = '<div class="history-empty">暂无手牌记录</div>';
      return;
    }
    list.innerHTML = hands.map(h => {
      let cardsHtml = '';
      if ((h.hole_cards && h.hole_cards.length > 0) || (h.community_cards && h.community_cards.length > 0)) {
        cardsHtml = `<div class="history-cards">`;
        if (h.hole_cards && h.hole_cards.length > 0) {
          cardsHtml += `
            <div class="history-cards-group">
              <span class="history-cards-label">底牌</span>
              ${h.hole_cards.map(c => `
                <div class="card sm ${this._isRed(c.suit) ? 'red' : ''}">
                  ${this._cardInnerHTML(c)}
                </div>
              `).join('')}
            </div>
          `;
        }
        if (h.community_cards && h.community_cards.length > 0) {
          cardsHtml += `
            <div class="history-cards-group">
              <span class="history-cards-label">公共牌</span>
              ${h.community_cards.map(c => `
                <div class="card sm ${this._isRed(c.suit) ? 'red' : ''}">
                  ${this._cardInnerHTML(c)}
                </div>
              `).join('')}
            </div>
          `;
        }
        cardsHtml += `</div>`;
      }

      return `
        <div class="history-item ${h.result}">
          <div class="history-item-left">
            <span class="history-date">${h.date}</span>
            <span class="history-action">${h.action}</span>
            ${cardsHtml}
          </div>
          <div class="history-item-right">
            <span class="history-profit ${h.result}">${h.profit >= 0 ? '+' : ''}${h.profit}</span>
            <span class="history-chips-after">→ ${h.finalChips} 筹码</span>
          </div>
        </div>
      `;
    }).join('');
  },

  // ── 游戏状态更新（由 SocketClient 调用） ──────────

  /** 主状态更新入口，接收完整 GameState 快照 */
  /** 主状态更新入口，接收完整 GameState 快照 */
  updateGameState(state) {
    this.state.game = state;
    
    // 调试辅助：核心状态变化输出
    console.log(`%c[GameState] 收到状态快照 | 手牌ID: ${state.handId} | 阶段: ${state.phase} | 底池: ${state.pot} | 公共牌: ${state.communityCards?.map(c => c.rank+c.suit).join(' ') || '无'}`, 'color: #00bcd4; font-weight: bold;');

    // 游戏开始：彻底收掉蒙层和角标
    document.getElementById('lobby-overlay').style.display = 'none';
    document.getElementById('waiting-indicator').hidden = true;

    document.getElementById('pot-amount').textContent = state.pot ?? 0;

    const phaseLabel = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌', ended: '比牌结算' };
    let statusText = phaseLabel[state.phase] || '';
    if (state.phase === 'ended' && state.results) {
      const winners = state.results.summary.filter(s => s.won > 0).map(s => s.username);
      statusText = winners.length > 0 ? `${winners.join(', ')} 赢得 ${state.pot} 筹码！` : '平局';
    }
    document.getElementById('game-status').textContent = statusText;

    if (state.communityCards) this.renderCommunityCards(state.communityCards);

    // 最强牌型实时提示
    const badge = document.getElementById('hand-type-badge');
    const badgeName = document.getElementById('hand-type-name');
    if (badge && badgeName) {
      if (state.heroHandType && state.phase !== 'ended') {
        badgeName.textContent = state.heroHandType;
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }

    // 局终结算特效触发
    if (state.phase === 'ended' && state.results) {
      // 1. 哨兵防重：同一手牌 ID 仅执行一次屏幕正中央大弹窗
      if (state.handId && state.handId !== this._lastSettlementHandId) {
        this._lastSettlementHandId = state.handId;
        this._showSettlementOverlay(state.results);
      }

      // 2. 哨兵防重：同一手牌 ID 仅执行一次筹码飞射动画
      if (state.handId && state.handId !== this._lastAnimateHandId) {
        this._lastAnimateHandId = state.handId;
        state.results.summary.forEach(s => {
          if (s.won > 0) {
            this._animateChips(s.seatId);
          }
        });
      }

      // 3. 哨兵防重：同一手牌 ID 仅执行一次飘字提示
      if (state.handId && state.handId !== this._lastFloatedHandId) {
        this._lastFloatedHandId = state.handId;
        state.results.summary.forEach(s => {
          if (s.won > 0 || s.paid > 0) {
            this._showFloatingProfit(s.seatId, s.profit, s.result);
          }
        });
      }
    }

    // 清理离桌或不在本局中的物理对手座位
    const activeSeatIds = new Set((state.players || []).map(p => p.seatId));
    for (let i = 1; i <= 5; i++) {
      if (!activeSeatIds.has(i)) {
        this.clearPlayerSeat(i);
      }
    }

    (state.players || []).forEach(p => {
      if (p.seatId === 0) this._updateHero(p);
      else                this.updatePlayerSeat(p);
    });
  },

  /** 新手牌开始，重置桌面 */
  startNewHand() {
    console.log('%c[Game] ====================== 新局开始 ======================', 'color: #e040fb; font-weight: bold; font-size: 14px;');
    // 清公共牌
    for (let i = 0; i < 5; i++) {
      const el = document.getElementById(`comm-${i}`);
      el.innerHTML = '';
      el.className = 'card card-placeholder';
    }
    // 清手牌
    ['hole-0', 'hole-1'].forEach(id => {
      const el = document.getElementById(id);
      el.innerHTML = '';
      el.className = 'card card-placeholder';
    });
    // 重置Hero手牌容器的透明度
    document.getElementById('hole-cards').style.opacity = '1';

    // 隐藏牌力提示标并重置文本
    const badge = document.getElementById('hand-type-badge');
    const badgeName = document.getElementById('hand-type-name');
    if (badge) badge.hidden = true;
    if (badgeName) badgeName.textContent = '高牌';

    // 清下注、状态
    document.querySelectorAll('.seat-bet-badge').forEach(el => el.hidden = true);
    document.querySelectorAll('.seat-action-label').forEach(el => el.textContent = '');
    document.querySelectorAll('.player-seat').forEach(el => {
      el.classList.remove('active-turn', 'folded', 'all-in');
    });
    document.getElementById('pot-amount').textContent = '0';
    document.getElementById('game-status').textContent = '翻牌前';
    document.getElementById('hero-bet-badge').hidden = true;
  },

  /** 渲染公共牌 */
  renderCommunityCards(cards) {
    for (let i = 0; i < 5; i++) {
      const el = document.getElementById(`comm-${i}`);
      if (cards[i]) {
        el.innerHTML  = this._cardInnerHTML(cards[i]);
        el.className  = 'card deal';
        if (this._isRed(cards[i].suit)) el.classList.add('red');
      } else {
        el.innerHTML = '';
        el.className = 'card card-placeholder';
      }
    }
  },

  /** 翻/转/河牌动画式发牌 */
  dealCommunityCards(cards) {
    cards.forEach((card, i) => {
      const el = document.getElementById(`comm-${i}`);
      if (card && el) {
        el.innerHTML = this._cardInnerHTML(card);
        el.className = 'card deal';
        if (this._isRed(card.suit)) el.classList.add('red');
      }
    });
  },

  /** 更新对手席位 */
  updatePlayerSeat(player) {
    const seat = document.getElementById(`seat-${player.seatId}`);
    if (!seat) return;

    seat.querySelector('.seat-name').textContent      = player.username;
    seat.querySelector('.seat-chips-val').textContent = `${player.chips}`;
    seat.querySelector('.avatar-initials').textContent = player.username.charAt(0).toUpperCase();

    const dealerBtn = seat.querySelector('.dealer-btn');
    dealerBtn.hidden = !player.isDealer;

    const betBadge = seat.querySelector('.seat-bet-badge');
    if (player.bet) {
      seat.querySelector('.bet-val').textContent = player.bet;
      betBadge.hidden = false;
    } else {
      betBadge.hidden = true;
    }

    // 动态渲染对手手牌
    const seatCards = seat.querySelector('.seat-cards');
    if (player.status === 'waiting') {
      seatCards.innerHTML = '';
      seatCards.style.opacity = '0.2';
    } else if (player.status === 'folded') {
      seatCards.innerHTML = `
        <div class="card card-back sm"></div>
        <div class="card card-back sm"></div>
      `;
      seatCards.style.opacity = '0.2';
    } else {
      seatCards.style.opacity = '1';
      if (player.holeCards && player.holeCards.length === 2) {
        // Showdown 摊牌，翻开明牌
        seatCards.innerHTML = player.holeCards.map(c => `
          <div class="card sm ${this._isRed(c.suit) ? 'red' : ''}">
            ${this._cardInnerHTML(c)}
          </div>
        `).join('');
      } else {
        // 游戏中进行状态，显示牌背
        seatCards.innerHTML = `
          <div class="card card-back sm"></div>
          <div class="card card-back sm"></div>
        `;
      }
    }

    this._applySeatStatus(seat, player.status);
  },

  /** 清空席位（玩家离桌） */
  clearPlayerSeat(seatId) {
    const seat = document.getElementById(`seat-${seatId}`);
    if (!seat) return;
    seat.querySelector('.seat-name').textContent      = '空座';
    seat.querySelector('.seat-chips-val').textContent = '–';
    seat.querySelector('.avatar-initials').textContent = '?';
    seat.querySelector('.seat-bet-badge').hidden = true;
    seat.querySelector('.dealer-btn').hidden     = true;
    seat.querySelector('.seat-cards').style.opacity = '1';
    seat.querySelector('.seat-cards').innerHTML  = ''; // 空座时不显示手牌占位背部
    seat.classList.remove('active-turn', 'folded', 'all-in');
  },

  /** 玩家行动文字提示 */
  onPlayerAction(data) {
    console.log(`%c[Action] 席位 ${data.seatId} 动作: ${data.action} | 金额: ${data.amount}`, 'color: #ff9800; font-weight: bold;');
    const seat = document.getElementById(`seat-${data.seatId}`);
    if (!seat) return;
    const labels = { fold: '弃牌', check: '过牌', call: `跟注 ${data.amount}`, raise: `加注 ${data.amount}`, allin: '全押' };
    const el = seat.querySelector('.seat-action-label');
    el.textContent = labels[data.action] || data.action;
    setTimeout(() => { el.textContent = ''; }, 2200);
  },

  /** 轮到本玩家行动 */
  showActionPanel(data) {
    console.log(`%c[Turn] 轮到本家行动！跟注额: ${data.callAmount} | 允许加注范围: [${data.minRaise}, ${data.maxRaise}] | 剩余思考时间: ${data.timeLimit}s`, 'color: #4caf50; font-weight: bold;');
    const panel = document.getElementById('action-panel');
    panel.hidden = false;

    const callAmt = data.callAmount || 0;
    document.getElementById('call-amount').textContent = callAmt;

    const slider = document.getElementById('raise-slider');
    slider.min   = data.minRaise || 0;
    slider.max   = data.maxRaise || (this.state.user?.chips ?? 1000);
    slider.value = data.minRaise || 0;
    document.getElementById('raise-min-label').textContent = data.minRaise || 0;
    document.getElementById('raise-max-label').textContent = data.maxRaise || slider.max;
    document.getElementById('raise-display').textContent   = slider.value;

    // 能过牌时显示"过牌"，否则显示"跟注"
    const canCheck = callAmt === 0;
    document.getElementById('btn-check').hidden = !canCheck;
    document.getElementById('btn-call').hidden  =  canCheck;

    document.getElementById('seat-0').classList.add('active-turn');
    this._startTimer(data.timeLimit || 30);
  },

  hideActionPanel() {
    document.getElementById('action-panel').hidden = true;
    document.getElementById('seat-0').classList.remove('active-turn');
    this._stopTimer();
  },

  /** 手牌结算 */
  showHandResult(data) {
    console.log(`%c[Settle] 局终结算广播 | 赢家: ${data.winner || '无'} | 总奖池: ${data.pot}`, 'color: #ff5722; font-weight: bold; font-size: 13px;');
    if (data.hands) {
      console.log('[Settle] 所有摊牌选手手牌详情:', data.hands);
    }
    const msg = data.winner
      ? `${data.winner} 赢得 ${data.pot} 筹码！`
      : '平局';
    document.getElementById('game-status').textContent = msg;
    // TODO: 翻开对手手牌（data.hands）
  },

  /** 玩家加入大厅（落座事件，step 5+ 会用上） */
  onPlayerJoined(data) {
    this._updateLobbyCount(data.totalCount);
    this._addLobbyPlayer(data.username);
  },

  /** 服务端大厅状态广播：整列表重建 */
  updateLobby(data) {
    const players = (data && data.players) || [];
    const count   = (data && typeof data.count === 'number') ? data.count : players.length;
    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    players.forEach(p => this._addLobbyPlayer(p.username));
    this._updateLobbyCount(count);
  },

  /** 更新筹码 */
  updateChips(data) {
    if (data.isHero || data.seatId === 0) {
      document.getElementById('hero-chips').textContent   = data.chips;
      document.getElementById('header-chips').textContent = data.chips;
      if (this.state.user) this.state.user.chips = data.chips;
    } else {
      const seat = document.getElementById(`seat-${data.seatId}`);
      if (seat) seat.querySelector('.seat-chips-val').textContent = data.chips;
    }
  },

  showError(msg) {
    console.error('[App]', msg);
    // TODO: 实现 toast 弹窗
  },

  // ── 私有辅助 ──────────────────────────────────────

  _updateHero(player) {
    document.getElementById('hero-chips').textContent   = player.chips;
    document.getElementById('header-chips').textContent = player.chips;

    if (player.holeCards?.length) {
      ['hole-0', 'hole-1'].forEach((id, i) => {
        const card = player.holeCards[i];
        if (!card) return;
        const el = document.getElementById(id);
        el.innerHTML = this._cardInnerHTML(card);
        el.className = 'card deal hole-card';
        if (this._isRed(card.suit)) el.classList.add('red');
      });
    }

    const holeCardsContainer = document.getElementById('hole-cards');
    if (player.status === 'folded') {
      holeCardsContainer.style.opacity = '0.2';
    } else {
      holeCardsContainer.style.opacity = '1';
    }

    const heroBet = document.getElementById('hero-bet-badge');
    if (player.bet) {
      document.getElementById('hero-bet').textContent = player.bet;
      heroBet.hidden = false;
    } else {
      heroBet.hidden = true;
    }

    document.getElementById('hero-dealer').hidden = !player.isDealer;
    this._applySeatStatus(document.getElementById('seat-0'), player.status);
  },

  _applySeatStatus(seat, status) {
    seat.classList.remove('active-turn', 'folded', 'all-in');
    if (status === 'acting')  seat.classList.add('active-turn');
    if (status === 'folded')  seat.classList.add('folded');
    if (status === 'allin')   seat.classList.add('all-in');
  },

  _cardInnerHTML(card) {
    return `<span class="card-rank-tl">${card.rank}</span>
            <span class="card-suit-center">${card.suit}</span>
            <span class="card-rank-br">${card.rank}</span>`;
  },

  _isRed(suit) { return suit === '♥' || suit === '♦'; },

  _addLobbyPlayer(username) {
    const list = document.getElementById('lobby-players');
    const item = document.createElement('div');
    item.className = 'lobby-player-item';
    item.innerHTML = `<span class="lobby-player-dot"></span><span>${username}</span>`;
    list.appendChild(item);
  },

  // ── 计时器 ────────────────────────────────────────

  _timerInterval: null,

  _startTimer(seconds) {
    this._stopTimer();
    const bar = document.getElementById('timer-bar');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    bar.classList.remove('urgent');

    let remaining = seconds;
    this._timerInterval = setInterval(() => {
      remaining--;
      const pct = Math.max(0, (remaining / seconds) * 100);
      bar.style.transition = 'width 1s linear';
      bar.style.width = pct + '%';
      if (remaining <= 10) bar.classList.add('urgent');
      if (remaining <= 0) {
        this._stopTimer();
        SocketClient.emit.fold();
        this.hideActionPanel();
      }
    }, 1000);
  },

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  },

  // ── 视觉特效实现 ──────────────────────────────────

  _lastSettlementHandId: null,
  _lastAnimateHandId: null,
  _lastFloatedHandId: null,

  /** 金色筹码飞射汇聚动画 */
  _animateChips(targetSeatId) {
    const tableEl = document.querySelector('.table-scene');
    const potEl = document.querySelector('.pot-row');
    const targetSeatEl = document.getElementById(`seat-${targetSeatId}`);
    if (!tableEl || !potEl || !targetSeatEl) return;

    const tableRect = tableEl.getBoundingClientRect();
    const potRect = potEl.getBoundingClientRect();
    const targetAvatar = targetSeatEl.querySelector('.seat-avatar');
    if (!targetAvatar) return;
    const targetRect = targetAvatar.getBoundingClientRect();

    // 起点坐标 (奖池中心，相对于 table-scene)
    const startX = potRect.left - tableRect.left + potRect.width / 2;
    const startY = potRect.top - tableRect.top + potRect.height / 2;

    // 终点坐标 (目标头像中心，相对于 table-scene)
    const endX = targetRect.left - tableRect.left + targetRect.width / 2;
    const endY = targetRect.top - tableRect.top + targetRect.height / 2;

    const numChips = 10;
    for (let i = 0; i < numChips; i++) {
      const chip = document.createElement('div');
      chip.className = 'chip-particle';
      // 粒子居中定位偏移
      chip.style.left = `${startX - 7}px`;
      chip.style.top = `${startY - 7}px`;
      chip.style.transform = 'translate(0, 0) scale(1)';
      tableEl.appendChild(chip);

      // 第一阶段：向随机方向爆射炸开
      const angle = Math.random() * Math.PI * 2;
      const radius = 25 + Math.random() * 30; // 25px 至 55px 爆炸扩散半径
      const scatterX = Math.cos(angle) * radius;
      const scatterY = Math.sin(angle) * radius;

      // 错落有致的流体动画延迟
      const delay = i * 40;

      setTimeout(() => {
        // 第一段：炸开
        chip.style.transform = `translate(${scatterX}px, ${scatterY}px) scale(1.1)`;

        // 第二阶段：在 300ms 后飞向目标席位头像并缩小、淡出
        setTimeout(() => {
          const finalX = endX - startX;
          const finalY = endY - startY;
          chip.style.transform = `translate(${finalX}px, ${finalY}px) scale(0.4)`;
          chip.style.opacity = '0';
        }, 300);

      }, delay);

      // 动画完成后从 DOM 清理粒子
      setTimeout(() => {
        chip.remove();
      }, delay + 1200);
    }
  },

  /** 输赢盈亏飘字特效 */
  _showFloatingProfit(seatId, profit, result) {
    const tableEl = document.querySelector('.table-scene');
    const seatEl = document.getElementById(`seat-${seatId}`);
    if (!tableEl || !seatEl) return;

    const tableRect = tableEl.getBoundingClientRect();
    const avatarEl = seatEl.querySelector('.seat-avatar');
    if (!avatarEl) return;
    const avatarRect = avatarEl.getBoundingClientRect();

    // 飘字居中及高度偏置计算
    const x = avatarRect.left - tableRect.left + avatarRect.width / 2;
    const y = avatarRect.top - tableRect.top - 10; // 略微浮在头像正上方

    const floatEl = document.createElement('div');
    floatEl.className = `floating-profit ${result}`;
    floatEl.style.left = `${x}px`;
    floatEl.style.top = `${y}px`;

    let text = '';
    if (result === 'win') {
      text = `🎉 赢 +${profit}`;
    } else if (result === 'loss') {
      // 格式化输出为 输 -XX 样式
      const formattedProfit = profit < 0 ? profit : `-${profit}`;
      text = `💸 输 ${formattedProfit}`;
    } else {
      text = `🤝 平局`;
    }

    floatEl.textContent = text;
    tableEl.appendChild(floatEl);

    // 与 CSS floatUpAndFade 1.8s 保持完全一致并销毁
    setTimeout(() => {
      floatEl.remove();
    }, 1800);
  },

  /** 屏幕正中央局终结算大弹窗（包含倒计时与自动淡出） */
  _showSettlementOverlay(results) {
    console.log('%c[SettleModal] 弹出屏幕正中结算大弹窗', 'color: #00e676; font-weight: bold;', results);

    const overlay = document.getElementById('settlement-overlay');
    const box = document.getElementById('settlement-box');
    const titleEl = document.getElementById('settlement-title');
    const profitEl = document.getElementById('settlement-player-profit');
    const detailEl = document.getElementById('settlement-detail');
    const subDetailsEl = document.getElementById('settlement-sub-details');
    const progressEl = document.getElementById('settlement-countdown-progress');

    if (!overlay || !box || !titleEl || !profitEl || !detailEl || !subDetailsEl || !progressEl) return;

    // 清理先前的状态类
    box.className = 'settlement-box';

    // 1. 找到本地玩家的盈亏数据 (通过 username 保证 100% 确定性)
    const myUsername = this.state.user?.username;
    const myResult = results.summary.find(s => s.username === myUsername);

    let profitText = '';
    if (myResult) {
      const p = myResult.profit;
      const fmtProfit = p >= 0 ? `+${p}` : `${p}`;
      
      if (p > 0) {
        box.classList.add('win');
        titleEl.textContent = '🎉 恭喜获胜！';
        profitEl.textContent = `你赢得了 ${p} 筹码`;
        document.getElementById('settlement-icon').textContent = '🏆';
      } else if (p < 0) {
        box.classList.add('loss');
        titleEl.textContent = '💔 遗憾落败';
        profitEl.textContent = `你输掉了 ${Math.abs(p)} 筹码`;
        document.getElementById('settlement-icon').textContent = '💸';
      } else {
        box.classList.add('push');
        titleEl.textContent = '🤝 平局结算';
        profitEl.textContent = `筹码未发生变化`;
        document.getElementById('settlement-icon').textContent = '✨';
      }
    } else {
      // 本人没有入座（旁观者）
      box.classList.add('push');
      titleEl.textContent = '🃏 牌局已结束';
      profitEl.textContent = `本局共结算 ${results.summary.length} 名玩家`;
      document.getElementById('settlement-icon').textContent = '♠';
    }

    // 2. 找到本局赢家的手牌信息
    const winners = results.summary.filter(s => s.won > 0);
    const winDetails = winners.map(w => `${w.username} (${w.categoryName || '未知牌型'})`).join(', ');
    detailEl.textContent = winDetails ? `赢家牌型: ${winDetails}` : '本局无赢家（全员弃牌或平分）';

    // 3. 填充所有选手的滚动盈亏列表
    subDetailsEl.innerHTML = results.summary.map(s => {
      const fmtP = s.profit >= 0 ? `+${s.profit}` : `${s.profit}`;
      const cls = s.profit > 0 ? 'win' : s.profit < 0 ? 'loss' : 'push';
      return `
        <div class="settlement-row">
          <span class="settlement-row-name">${s.username}</span>
          <span class="settlement-row-profit ${cls}">${fmtP} 筹码</span>
        </div>
      `;
    }).join('');

    // 4. 重置并激活倒计时进度条 (5.5 秒后自动关闭，契合服务器的 6 秒结算间隔)
    progressEl.style.transition = 'none';
    progressEl.style.width = '100%';
    // 强制触发 DOM 重绘以使过渡动效生效
    progressEl.offsetHeight; 
    progressEl.style.transition = 'width 5.3s linear';
    progressEl.style.width = '0%';

    // 5. 显现弹窗
    overlay.classList.add('active');

    // 6. 设定定时器自动撤销弹窗
    if (this._settlementTimer) clearTimeout(this._settlementTimer);
    this._settlementTimer = setTimeout(() => {
      overlay.classList.remove('active');
    }, 5500);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
