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

// ── 高保真爵士乐 BGM 与牌局音效合成系统 (Web Audio API) ──
const AudioEngine = {
  ctx: null,
  bgm: null,
  bgmPlaying: false,
  proceduralInterval: null,

  init() {
    // 兼容浏览器静音唤醒策略
    const initCtx = () => {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    };
    document.addEventListener('click', initCtx, { once: true });
    document.addEventListener('touchstart', initCtx, { once: true });

    // 初始化 BGM 实例 (Mixkit 极其舒缓优雅的爵士乐)
    this.bgm = new Audio('https://assets.mixkit.co/music/preview/mixkit-smooth-jazz-2067.mp3');
    this.bgm.loop = true;
    this.bgm.volume = 0.06; // 细腻舒适的环境音量

    // 监听网络加载错误或跨域拦截，无缝降级到 procedural 实时合成
    this.bgm.addEventListener('error', () => {
      console.warn('[AudioEngine] 外部爵士乐 BGM 加载失败，无缝降级至 Web Audio 实时合成 Lo-Fi 爵士乐。');
      if (this.bgmPlaying && !this.proceduralInterval) {
        this._startProceduralJazz();
      }
    });

    // 读取本地音乐偏好
    const savedMusic = localStorage.getItem('poker_night_bgm');
    if (savedMusic === 'on') {
      const startOnInteract = () => {
        initCtx();
        this.setBGM(true);
      };
      document.addEventListener('click', startOnInteract, { once: true });
    }
  },

  setBGM(play) {
    this.bgmPlaying = play;
    localStorage.setItem('poker_night_bgm', play ? 'on' : 'off');
    
    // 同步顶部 header 按钮的霓虹发光样式
    const btn = document.getElementById('btn-music');
    if (btn) {
      if (play) {
        btn.textContent = '🎷 爵士乐: 开';
        btn.style.borderColor = 'var(--gold)';
        btn.style.background = 'rgba(201, 168, 76, 0.15)';
        btn.style.boxShadow = '0 0 10px rgba(201, 168, 76, 0.4)';
        btn.style.color = 'var(--gold-light)';
      } else {
        btn.textContent = '🎷 爵士乐: 关';
        btn.style.borderColor = 'rgba(201, 168, 76, 0.3)';
        btn.style.background = 'transparent';
        btn.style.boxShadow = 'none';
        btn.style.color = 'var(--gold)';
      }
    }

    if (!play) {
      if (this.bgm) this.bgm.pause();
      this._stopProceduralJazz();
      return;
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.bgm.play().then(() => {
      this._stopProceduralJazz(); // 加载成功则停用合成音乐
    }).catch(() => {
      console.log('[AudioEngine] 浏览器自动播放拦截，改用 Web Audio 实时合成优雅的 Lo-Fi 爵士乐。');
      this._startProceduralJazz();
    });
  },

  toggleBGM() {
    this.setBGM(!this.bgmPlaying);
  },

  // 纯原生振荡器生成 100% 离线、零延迟高清音效
  playSFX(type) {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    try {
      switch (type) {
        case 'deal':
          this._synthDeal();
          break;
        case 'chip':
          this._synthChip();
          break;
        case 'check':
          this._synthCheck();
          break;
        case 'fold':
          this._synthFold();
          break;
      }
    } catch (e) {
      console.error('[AudioEngine] 音效合成错误:', e);
    }
  },

  _synthDeal() {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 白噪音生成发牌摩擦声
    const bufferSize = ctx.sampleRate * 0.14;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(3.2, now);
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.14);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + 0.15);
  },

  _synthChip(pitchMultiplier = 1.0, volumeFactor = 1.0) {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 陶瓷/金属筹码清脆撞击双正弦谐波
    const f1 = 2050 * pitchMultiplier;
    const f2 = 2700 * pitchMultiplier;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(f1, now);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(f2, now + 0.003); // 3ms 撞击延迟

    gainNode.gain.setValueAtTime(0.15 * volumeFactor, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.003);

    osc1.stop(now + 0.09);
    osc2.stop(now + 0.09);
  },

  _synthCheck() {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode1 = ctx.createGain();
    const gainNode2 = ctx.createGain();

    // 沉稳的实木桌面“叩击两声”
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(155, now);
    gainNode1.gain.setValueAtTime(0.42, now);
    gainNode1.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc1.connect(gainNode1);
    gainNode1.connect(ctx.destination);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(145, now + 0.11);
    gainNode2.gain.setValueAtTime(0.32, now + 0.11);
    gainNode2.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

    osc2.connect(gainNode2);
    gainNode2.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.11);

    osc1.stop(now + 0.1);
    osc2.stop(now + 0.21);
  },

  _synthFold() {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 低通纸张滑走声
    const bufferSize = ctx.sampleRate * 0.22;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(950, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + 0.20);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + 0.21);
  },

  // ── PROCEDURAL LO-FI JAZZ LOOP (Web Audio 合成优雅爵士乐) ──
  // 零体积占用，高逼格实时合成 walking bass、Rhodes 温润和弦与摇摆 ride 叮擦！
  _startProceduralJazz() {
    this._stopProceduralJazz();
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    console.log('[AudioEngine] 启动 Lo-Fi 爵士乐合成循环...');
    let beat = 0;
    
    // 爵士 7 和弦组: FM7 -> G7 -> Em7 -> Am7
    const chords = [
      [174.61, 220.00, 261.63, 329.63], // FM7 (F3, A3, C4, E4)
      [196.00, 246.94, 293.66, 349.23], // G7  (G3, B3, D4, F4)
      [164.81, 196.00, 246.94, 293.66], // Em7 (E3, G3, B3, D4)
      [220.00, 261.63, 329.63, 392.00]  // Am7 (A3, C4, E4, G4)
    ];

    // 优雅的爵士 Walking Bassline
    const basslines = [
      [87.31, 110.00, 130.81, 123.47], // F3 -> A3 -> C4 -> B3
      [98.00, 123.47, 146.83, 138.59], // G3 -> B3 -> D4 -> C#4
      [82.41, 98.00, 123.47, 116.54],  // E3 -> G3 -> B3 -> Bb3
      [110.00, 130.81, 164.81, 98.00]  // A3 -> C4 -> E4 -> G3
    ];

    const bpm = 96;
    const beatInterval = 60000 / bpm; // 节拍时间 (ms)

    this.proceduralInterval = setInterval(() => {
      try {
        const now = this.ctx.currentTime;
        const measure = Math.floor(beat / 4) % chords.length;
        const beatOfMeasure = beat % 4;

        // 1. Walking Bass (每拍走一步)
        const bassFreq = basslines[measure][beatOfMeasure];
        const bassOsc = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        bassOsc.type = 'triangle'; // 三角波重现原声木贝斯温厚颗粒感
        bassOsc.frequency.setValueAtTime(bassFreq / 2, now); // 下沉低八度
        bassGain.gain.setValueAtTime(0.08, now);
        bassGain.gain.exponentialRampToValueAtTime(0.001, now + (beatInterval / 1000) * 0.96);
        bassOsc.connect(bassGain);
        bassGain.connect(this.ctx.destination);
        bassOsc.start(now);
        bassOsc.stop(now + (beatInterval / 1000));

        // 2. 温润 Rhodes 和弦 (小节首拍长音响起，缓缓消散)
        if (beatOfMeasure === 0) {
          chords[measure].forEach(freq => {
            const chordOsc = this.ctx.createOscillator();
            const chordGain = this.ctx.createGain();
            const filter = this.ctx.createBiquadFilter();
            
            chordOsc.type = 'triangle';
            chordOsc.frequency.setValueAtTime(freq, now);
            
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(600, now); // 低通滤波滤去刺耳频率，成就醇厚毛毡 Rhodes 质感
            
            chordGain.gain.setValueAtTime(0.024, now);
            chordGain.gain.exponentialRampToValueAtTime(0.001, now + 3.1);
            
            chordOsc.connect(filter);
            filter.connect(chordGain);
            chordGain.connect(this.ctx.destination);
            
            chordOsc.start(now);
            chordOsc.stop(now + 3.2);
          });
        }

        // 3. 经典的爵士 Ride 吊镲律动 ("Spang-a-lang")
        this._playCymbal(now);
        if (beatOfMeasure === 1 || beatOfMeasure === 3) {
          // 摇摆三连音附点跳跃
          this._playCymbal(now + (beatInterval / 1000) * 0.66);
        }

        beat++;
      } catch (e) {
        console.error('[AudioEngine] 爵士乐实时合成异常:', e);
      }
    }, beatInterval);
  },

  _playCymbal(time) {
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 0.08;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(9000, time);
    filter.Q.setValueAtTime(1.2, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.007, time); // 极致细腻微弱的吊镲击打
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(time);
    noise.stop(time + 0.08);
  },

  _stopProceduralJazz() {
    if (this.proceduralInterval) {
      clearInterval(this.proceduralInterval);
      this.proceduralInterval = null;
      console.log('[AudioEngine] Lo-Fi 爵士乐合成循环已停止。');
    }
  }
};

const App = {

  state: {
    user: null,       // { username, chips }
    game: null,       // 最新 GameState
  },

  // ── 启动 ──────────────────────────────────────────

  async init() {
    // 初始化音效引擎
    AudioEngine.init();

    // 挂载全局充值弹窗辅助，方便 HTML 行内事件触发
    window.closeGlobalAlert = () => this.closeGlobalAlert();

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

  showGlobalNotification(data) {
    console.log('[App] 收到全局广播通知:', data);
    
    // 如果是充值事件，播放音效（用已有的筹码音效）
    if (data.type === 'buyin') {
      AudioEngine.playSFX('chip');
    }
    
    const overlay = document.getElementById('global-alert-overlay');
    const contentEl = document.getElementById('global-alert-content');
    const titleEl = document.getElementById('global-alert-title');
    
    if (overlay && contentEl) {
      if (titleEl && data.type === 'buyin') {
        titleEl.textContent = '💰 筹码充值广播';
      } else if (titleEl) {
        titleEl.textContent = '📢 系统广播';
      }
      
      contentEl.innerHTML = data.message;
      overlay.classList.add('active');
      
      // 5秒后自动关闭
      if (this._globalAlertTimer) clearTimeout(this._globalAlertTimer);
      this._globalAlertTimer = setTimeout(() => {
        this.closeGlobalAlert();
      }, 5000);
    }
    
    // 同时也自动更新对应席位或玩家筹码
    if (data.type === 'buyin') {
      // 如果加的是自己，更新本地 header 和 hero-chips 的筹码显示
      if (this.state.user && this.state.user.username === data.username) {
        this.state.user.chips = data.totalChips;
        const headChips = document.getElementById('header-chips');
        if (headChips) headChips.textContent = data.totalChips;
        const heroChips = document.getElementById('hero-chips');
        if (heroChips) heroChips.textContent = data.totalChips;
      }
    }
  },

  closeGlobalAlert() {
    const overlay = document.getElementById('global-alert-overlay');
    if (overlay) {
      overlay.classList.remove('active');
    }
    if (this._globalAlertTimer) {
      clearTimeout(this._globalAlertTimer);
      this._globalAlertTimer = null;
    }
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

    document.getElementById('btn-music').addEventListener('click', () => {
      AudioEngine.toggleBGM();
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

    // 渲染回合指示器
    const turnIndicator = document.getElementById('turn-indicator');
    const turnText = document.getElementById('turn-text');
    if (turnIndicator && turnText) {
      if (typeof state.currentSeat === 'number' && state.phase !== 'ended') {
        turnIndicator.hidden = false;
        
        // 查找该 seat 的玩家名字
        const activePlayer = state.players.find(p => p.seatId === state.currentSeat);
        const name = activePlayer ? activePlayer.username : `席位 ${state.currentSeat}`;
        
        // 判断是否是本家回合
        const isMyTurn = state.currentSeat === 0;
        if (isMyTurn) {
          turnIndicator.className = 'turn-indicator my-turn';
          turnText.innerHTML = `📢 <strong>轮到您行动了！请下注！</strong>`;
        } else {
          turnIndicator.className = 'turn-indicator opponent-turn';
          turnText.innerHTML = `⏳ 正在等待 <strong>${name}</strong> 行动...`;
        }
      } else {
        turnIndicator.hidden = true;
      }
    }

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
    // 新手牌发牌音效
    AudioEngine.playSFX('deal');

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

    // 重置回合指示器
    const turnIndicator = document.getElementById('turn-indicator');
    if (turnIndicator) turnIndicator.hidden = true;

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
    // 播放发牌音效
    AudioEngine.playSFX('deal');

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

    if (player.isOffline) {
      seat.classList.add('offline');
    } else {
      seat.classList.remove('offline');
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
    seat.classList.remove('active-turn', 'folded', 'all-in', 'offline');
  },

  /** 玩家行动文字提示 */
  onPlayerAction(data) {
    console.log(`%c[Action] 席位 ${data.seatId} 动作: ${data.action} | 金额: ${data.amount}`, 'color: #ff9800; font-weight: bold;');
    
    // 播放相应动作音效
    if (data.action === 'fold') {
      AudioEngine.playSFX('fold');
    } else if (data.action === 'check') {
      AudioEngine.playSFX('check');
    } else if (data.action === 'call' || data.action === 'raise' || data.action === 'allin') {
      AudioEngine.playSFX('chip');
    }

    const seat = document.getElementById(`seat-${data.seatId}`);
    if (!seat) return;
    const labels = { fold: '弃牌', check: '过牌', call: `跟注 ${data.amount}`, raise: `加注 ${data.amount}`, allin: '全押' };
    
    // 1. 头像下方的常驻动作文本（短暂停留后消除）
    const el = seat.querySelector('.seat-action-label');
    if (el) {
      el.textContent = labels[data.action] || data.action;
      setTimeout(() => { el.textContent = ''; }, 2200);
    }

    // 2. 动态生成飘字动画效果 (带有3D平移淡出)
    const floatEl = document.createElement('div');
    floatEl.className = 'action-float-text';
    if (data.action === 'fold') {
      floatEl.className += ' fold';
      floatEl.textContent = '弃牌 ✖️';
    } else if (data.action === 'check') {
      floatEl.className += ' fold';
      floatEl.textContent = '过牌 ✊';
    } else if (data.action === 'call') {
      floatEl.className += ' call';
      floatEl.textContent = `跟注 +${data.amount} 💰`;
    } else if (data.action === 'raise') {
      floatEl.className += ' raise';
      floatEl.textContent = `加注 +${data.amount} 🚀`;
    } else if (data.action === 'allin') {
      floatEl.className += ' raise';
      floatEl.textContent = '全押 🔥';
    } else {
      floatEl.textContent = data.action;
    }
    
    seat.appendChild(floatEl);
    
    // 动画播放完毕自动销毁 (动画时间 1.1s)
    setTimeout(() => {
      floatEl.remove();
    }, 1100);
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
    
    const heroSeat = document.getElementById('seat-0');
    if (heroSeat) {
      if (player.isOffline) {
        heroSeat.classList.add('offline');
      } else {
        heroSeat.classList.remove('offline');
      }
    }

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

  /** 金色筹码曲线飞射汇聚动画与物理受击反馈 */
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

    // 动态注入样式表支持高级抛物线动画
    const styleId = 'dynamic-coin-animations';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const numChips = 22; // 提升至 22 颗金色筹码
    const timestamp = Date.now();

    for (let i = 0; i < numChips; i++) {
      const chip = document.createElement('div');
      chip.className = 'chip-particle';
      chip.style.left = `${startX - 8}px`; // 微调居中
      chip.style.top = `${startY - 8}px`;
      tableEl.appendChild(chip);

      // 第一段：向随机方向爆射炸开的物理偏置
      const angle = Math.random() * Math.PI * 2;
      const radius = 30 + Math.random() * 35; // 30px 至 65px 爆破扩散半径
      const scatterX = Math.cos(angle) * radius;
      const scatterY = Math.sin(angle) * radius;

      // 目标终点相对位移
      const finalX = endX - startX;
      const finalY = endY - startY;

      // 黄金贝塞尔弧线控制点：中途往上方和随机左右偏置抛射，模拟抛物线
      const midX = scatterX + (finalX - scatterX) * 0.45 + (Math.random() * 40 - 20);
      const midY = Math.min(scatterY, finalY) - (110 + Math.random() * 60); // 强力弧度向上拉起

      // 独一无二的随机金币轨道动画名
      const animName = `coin-trajectory-${targetSeatId}-${i}-${timestamp}`;

      // 写入硬件加速的 CSS Keyframes 规则
      try {
        styleEl.sheet.insertRule(`
          @keyframes ${animName} {
            0% {
              transform: translate(0, 0) scale(0.6);
              opacity: 0;
            }
            12% {
              transform: translate(${scatterX}px, ${scatterY}px) scale(1.3);
              opacity: 1;
            }
            45% {
              transform: translate(${midX}px, ${midY}px) scale(1.1);
              opacity: 0.95;
            }
            100% {
              transform: translate(${finalX}px, ${finalY}px) scale(0.35);
              opacity: 0;
            }
          }
        `, 0);
      } catch (e) {
        // 防止同名注入冲突
      }

      // 给粒子应用动态动画
      const delay = i * 35; // 错落有致的瀑布流延迟
      chip.style.animation = `${animName} 1.05s cubic-bezier(0.12, 0.85, 0.35, 1.0) ${delay}ms forwards`;

      // 音效与头像物理受击的节奏同步 (1.05s 的动画在 delay+1000ms 左右撞击目标)
      const hitTime = delay + 960;
      const pitchMultiplier = 0.85 + (i * 0.018); // 音调上扬

      setTimeout(() => {
        // 1. 播放陶瓷/金属筹码清脆落地雨声
        try {
          AudioEngine._synthChip(pitchMultiplier, 0.25 - (i * 0.003));
        } catch (e) {}

        // 2. 触发座位头像物理果冻般弹性缩放
        targetAvatar.classList.remove('bump');
        targetAvatar.offsetWidth; // 触发 reflow
        targetAvatar.classList.add('bump');
      }, hitTime);

      // 动画完全结束后，销毁粒子 DOM 节点并移除对应的 CSS 规则
      setTimeout(() => {
        chip.remove();
        try {
          // 清理样式规则，防止内存泄漏
          for (let j = 0; j < styleEl.sheet.cssRules.length; j++) {
            if (styleEl.sheet.cssRules[j].name === animName) {
              styleEl.sheet.deleteRule(j);
              break;
            }
          }
        } catch (e) {}
      }, delay + 1300);
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
