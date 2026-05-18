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

    SocketClient.connect(null); // TODO: step 4 接入 socket，session cookie 自动同源带上
    this._showView('game');
    document.getElementById('lobby-overlay').style.display = 'flex';
    // 重置大厅（避免登出后重登残留旧条目）
    document.getElementById('lobby-players').innerHTML = '';
    document.getElementById('lobby-count').textContent = '1';
    this._addLobbyPlayer(user.username);
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
      // TODO: const res = await fetch('/api/history');
      // TODO: const { hands } = await res.json();
      // 占位符：示例数据
      const hands = [
        { id: 1, date: '2024-01-15 21:45', result: 'win',  profit: +320, finalChips: 1320, action: '翻牌圈全押，赢得底池' },
        { id: 2, date: '2024-01-15 21:30', result: 'loss', profit: -150, finalChips: 1000, action: 'AK 对 AA，被跟注' },
        { id: 3, date: '2024-01-15 21:10', result: 'win',  profit:  +80, finalChips: 1150, action: '偷盲成功' },
        { id: 4, date: '2024-01-15 20:55', result: 'push', profit:    0, finalChips: 1070, action: '平局，各自取回' },
      ];
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

    const list = document.getElementById('history-list');
    if (!hands.length) {
      list.innerHTML = '<div class="history-empty">暂无手牌记录</div>';
      return;
    }
    list.innerHTML = hands.map(h => `
      <div class="history-item ${h.result}">
        <div class="history-item-left">
          <span class="history-date">${h.date}</span>
          <span class="history-action">${h.action}</span>
        </div>
        <div class="history-item-right">
          <span class="history-profit ${h.result}">${h.profit >= 0 ? '+' : ''}${h.profit}</span>
          <span class="history-chips-after">→ ${h.finalChips} 筹码</span>
        </div>
      </div>
    `).join('');
  },

  // ── 游戏状态更新（由 SocketClient 调用） ──────────

  /** 主状态更新入口，接收完整 GameState 快照 */
  updateGameState(state) {
    this.state.game = state;
    document.getElementById('lobby-overlay').style.display = 'none';

    document.getElementById('pot-amount').textContent = state.pot ?? 0;

    const phaseLabel = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' };
    document.getElementById('game-status').textContent = phaseLabel[state.phase] || '';

    if (state.communityCards) this.renderCommunityCards(state.communityCards);

    (state.players || []).forEach(p => {
      if (p.seatId === 0) this._updateHero(p);
      else                this.updatePlayerSeat(p);
    });
  },

  /** 新手牌开始，重置桌面 */
  startNewHand() {
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

    // 隐藏弃牌者手牌
    const seatCards = seat.querySelector('.seat-cards');
    seatCards.style.opacity = player.status === 'folded' ? '0.2' : '1';

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
    seat.classList.remove('active-turn', 'folded', 'all-in');
  },

  /** 玩家行动文字提示 */
  onPlayerAction(data) {
    const seat = document.getElementById(`seat-${data.seatId}`);
    if (!seat) return;
    const labels = { fold: '弃牌', check: '过牌', call: `跟注 ${data.amount}`, raise: `加注 ${data.amount}`, allin: '全押' };
    const el = seat.querySelector('.seat-action-label');
    el.textContent = labels[data.action] || data.action;
    setTimeout(() => { el.textContent = ''; }, 2200);
  },

  /** 轮到本玩家行动 */
  showActionPanel(data) {
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
    const msg = data.winner
      ? `${data.winner} 赢得 ${data.pot} 筹码！`
      : '平局';
    document.getElementById('game-status').textContent = msg;
    // TODO: 翻开对手手牌（data.hands）
  },

  /** 玩家加入大厅 */
  onPlayerJoined(data) {
    document.getElementById('lobby-count').textContent = data.totalCount;
    this._addLobbyPlayer(data.username);
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
};

document.addEventListener('DOMContentLoaded', () => App.init());
