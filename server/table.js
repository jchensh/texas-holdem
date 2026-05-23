/**
 * 单桌房间管理器 (Step 6)
 *
 * 核心职责：
 * 1. 玩家坐下 (Auto-Seating) 与断线重连托管，最大支持 10 名在线玩家（6人入座，4人观战）。
 * 2. 绝对座位 (0..5) 与客户端相对座位 (以接收者为座位 0) 的自动转换。
 * 3. 倒计时器管理，超时自动 Fold/Check。
 * 4. 驱动游戏进程 (new Game -> act -> next phase -> showdown -> settle -> delay -> start next)。
 * 5. 筹码扣减/赢取持久化到数据库 `users` 与 `hand_history`。
 */
const config = require('./config');
const db = require('./db');
const { Game } = require('./engine/game');

class Table {
  constructor() {
    this.io = null;
    // 6 个物理绝对座位 (0..5)
    // 存放: null 或 { userId, username, chips, socketIds: Set<string> }
    this.seats = Array(6).fill(null);
    // 旁观者 socket.id -> { userId, username, chips, socket }
    this.spectators = new Map();
    // 当前德扑引擎 Game 实例
    this.game = null;
    // 绝对座位号的庄家按钮位置
    this.dealerSeat = null;
    // 手牌计数器
    this.handIdCounter = 0;
    // 当前回合倒计时定时器
    this.timer = null;
  }

  /**
   * 关联 Socket.IO 实例
   */
  attach(io) {
    this.io = io;
  }

  /**
   * 获取当前房间所有独立用户的唯一 ID 集合
   */
  getUniqueOnlineUsers() {
    const seenIds = new Set();
    for (const seat of this.seats) {
      if (seat) seenIds.add(seat.userId);
    }
    for (const spec of this.spectators.values()) {
      seenIds.add(spec.userId);
    }
    return seenIds;
  }

  /**
   * 玩家上线/连接，处理自动坐下与多端连接绑定
   */
  sitPlayer(user, socket) {
    const userId = user.id;

    // 1. 检查该玩家是否已经坐下 (物理座位重连)
    let seatIndex = this.seats.findIndex(s => s && s.userId === userId);
    if (seatIndex !== -1) {
      this.seats[seatIndex].socketIds.add(socket.id);
      socket.data.seatId = seatIndex;
      console.log(`[Table] 玩家 ${user.username} 重新绑定至座位 ${seatIndex} (${socket.id})`);
      this.syncLobbyState();
      
      // 如果游戏正在进行，立即广播最新的游戏状态（使所有人屏幕上的置灰和离线状态立即解除）
      if (this.game) {
        this.broadcastGameState();
        // 如果刚好是他的回合，重新触发 startActionTimer 恢复 full 30s 倒计时并补发 your_turn
        if (this.game.currentSeat === seatIndex) {
          console.log(`[Table] 玩家 ${user.username} 在其回合内重连，恢复 30s 倒计时`);
          this.startActionTimer(seatIndex);
        }
      }
      return;
    }

    // 2. 检查该玩家是否已经在旁观列表中
    for (const spec of this.spectators.values()) {
      if (spec.userId === userId) {
        // 多 Tab 旁观，直接记录
        this.spectators.set(socket.id, { userId, username: user.username, chips: user.chips, socket });
        socket.data.seatId = null;
        this.syncLobbyState();
        if (this.game) {
          this.sendToSocket(socket, 'game_state', this.game.getPublicState());
        }
        return;
      }
    }

    // 3. 全新连接：校验房间最大人数限制（最多 10 人在线）
    const onlineIds = this.getUniqueOnlineUsers();
    if (onlineIds.size >= 10 && !onlineIds.has(userId)) {
      socket.emit('error', { message: '房间人数已满（最多 10 人在线）' });
      socket.disconnect(true);
      return;
    }

    // 4. 尝试寻找空座分配坐下
    const emptyIndex = this.seats.indexOf(null);
    if (emptyIndex !== -1 && (!this.game || this.game.phase === 'ended')) {
      // 没开局或局间可以立刻坐下
      this.seats[emptyIndex] = {
        userId,
        username: user.username,
        chips: user.chips,
        socketIds: new Set([socket.id])
      };
      socket.data.seatId = emptyIndex;
      console.log(`[Table] 玩家 ${user.username} 自动分配坐下座位 ${emptyIndex} (${socket.id})`);
      this.broadcast('player_joined', {
        seatId: emptyIndex,
        username: user.username,
        chips: user.chips,
        totalCount: this.getSeatedCount()
      });
    } else {
      // 满员或者游戏正在进行中，先作为观战者
      this.spectators.set(socket.id, { userId, username: user.username, chips: user.chips, socket });
      socket.data.seatId = null;
      console.log(`[Table] 玩家 ${user.username} 作为旁观者加入 (${socket.id})`);
    }

    this.syncLobbyState();
    
    // 广播或补发游戏状态
    if (this.game) {
      this.sendToSocket(socket, 'game_state', this.game.getPublicState());
    }

    // 自动开局校验
    this.checkAutoStart();
  }

  /**
   * 处理 Socket 断开连接
   */
  handleDisconnect(socket) {
    const seatIndex = socket.data.seatId;

    if (seatIndex !== null && seatIndex !== undefined) {
      const seat = this.seats[seatIndex];
      if (seat) {
        seat.socketIds.delete(socket.id);
        console.log(`[Table] 座位 ${seatIndex} (${seat.username}) 失去连接 ${socket.id} — 剩余 ${seat.socketIds.size} 个 socket`);
        
        // 若该玩家已无任何活跃 socket 连接（彻底断开）
        if (seat.socketIds.size === 0) {
          // 游戏进行中：保留座位，由超时自动弃牌托管
          if (this.game && this.game.phase !== 'ended') {
            console.log(`[Table] 玩家 ${seat.username} 彻底断开，但手牌进行中，保留席位托管`);
            // 立即广播当前游戏状态以使对手屏幕能立刻看到“离线”置灰与霓虹标签
            this.broadcastGameState();
            // 如果刚好轮到他的回合，立即加速其思考倒计时到 2 秒超速超时
            if (this.game.currentSeat === seatIndex) {
              console.log(`[Table] 玩家 ${seat.username} 在其回合断开，加速倒计时至 2 秒`);
              this.startActionTimer(seatIndex);
            }
          } else {
            // 游戏未进行：立即站起空出座位
            console.log(`[Table] 玩家 ${seat.username} 彻底离线，空出座位 ${seatIndex}`);
            this.seats[seatIndex] = null;
            this.broadcast('player_left', { seatId: seatIndex });
          }
        }
      }
    } else {
      // 从观战列表中移除
      this.spectators.delete(socket.id);
    }

    this.syncLobbyState();
    this.checkAutoStart();
  }

  /**
   * 获取已坐下的玩家数量
   */
  getSeatedCount() {
    return this.seats.filter(Boolean).length;
  }

  /**
   * 自动开局判定：若没有进行中的局，且坐下人数 >= 2，则启动游戏
   */
  checkAutoStart() {
    if (this.game && this.game.phase !== 'ended') return;
    if (this.getSeatedCount() >= 2) {
      // 延迟 1.5 秒开局，避免重连瞬间抖动引发冲突
      if (!this._autoStartTimer) {
        this._autoStartTimer = setTimeout(() => {
          this._autoStartTimer = null;
          this.startNextHand();
        }, 1500);
      }
    }
  }

  /**
   * 启动下一手牌
   */
  startNextHand() {
    if (this.game && this.game.phase !== 'ended') return;
    this.clearActionTimer();

    // 1. 过滤并处理所有已坐下的玩家（充值筹码与就绪）
    const playersForEngine = this.seats
      .map((seat, seatId) => {
        if (!seat) return null;
        // 如果筹码归零，自动重置充值 1000
        if (seat.chips <= 0) {
          seat.chips = config.STARTING_CHIPS;
          db.prepare('UPDATE users SET chips = ? WHERE id = ?').run(seat.chips, seat.userId);
          this.broadcast('chips_update', { seatId, chips: seat.chips, isHero: false });
        }
        return {
          id: seat.userId,
          seatId: seatId,
          username: seat.username,
          chips: seat.chips
        };
      })
      .filter(Boolean);

    if (playersForEngine.length < 2) {
      console.log('[Table] 活跃玩家少于 2 人，无法开局');
      this.game = null;
      this.broadcast('game_state', null);
      return;
    }

    // 2. 计算 Dealer 座位移动
    if (this.dealerSeat === null) {
      // 首局：取第一个有座的绝对座位号
      this.dealerSeat = this.seats.findIndex(Boolean);
    } else {
      // 顺时针寻找下一位有座的物理席位
      let nextDealer = this.dealerSeat;
      for (let i = 1; i <= 6; i++) {
        const idx = (this.dealerSeat + i) % 6;
        if (this.seats[idx]) {
          nextDealer = idx;
          break;
        }
      }
      this.dealerSeat = nextDealer;
    }

    this.handIdCounter++;
    const handId = `H-${Date.now()}-${this.handIdCounter}`;
    console.log(`[Table] 开始一手牌: ${handId} | Dealer 座位: ${this.dealerSeat}`);

    // 3. 构建扑克引擎实例
    this.game = new Game({
      players: playersForEngine,
      dealerSeat: this.dealerSeat,
      smallBlind: config.SMALL_BLIND,
      bigBlind: config.BIG_BLIND,
      handId
    });

    // 4. 同步更新 seats 的本地筹码量（扣除盲注后）
    for (const p of this.game.players) {
      if (this.seats[p.seatId]) {
        this.seats[p.seatId].chips = p.chips;
      }
    }

    // 5. 广播发牌与状态更新
    const baseState = this.game.getPublicState();
    this.broadcast('new_hand', { state: baseState });
    this.broadcastGameState();

    // 6. 激活首个玩家行动倒计时
    this.startActionTimer(this.game.currentSeat);
  }

  /**
   * 处理玩家下注行动
   */
  handlePlayerAction(socket, action) {
    if (!this.game) return;
    const seatId = socket.data.seatId;

    if (seatId !== this.game.currentSeat) {
      socket.emit('error', { message: '当前不是你的回合' });
      return;
    }

    try {
      this.clearActionTimer();

      // 执行行动
      const result = this.game.act(seatId, action);

      // 计算动画文字类型
      const p = this.game._playerBySeat(seatId);
      const actType = (p && p.status === 'allin') ? 'allin' : action.type;
      
      let amount = 0;
      if (action.type === 'raise') {
        amount = action.amount;
      } else if (action.type === 'call') {
        // 跟注额是 logEntry 里的 amount
        const lastLog = this.game.actionLog[this.game.actionLog.length - 1];
        amount = lastLog ? lastLog.amount : 0;
      }

      this.broadcast('player_action', { seatId, action: actType, amount });
      this.handleGameEngineResult(result, seatId, action);
    } catch (err) {
      console.error('[Table] 玩家非法行动:', err.message);
      socket.emit('error', { message: err.message });
      // 动作被驳回，给玩家重新开启倒计时
      this.startActionTimer(seatId);
    }
  }

  /**
   * 行动执行后的公共处理链路
   */
  handleGameEngineResult(result, seatId, action) {
    // 1. 同步所有玩家的实时筹码额
    for (const p of this.game.players) {
      if (this.seats[p.seatId]) {
        this.seats[p.seatId].chips = p.chips;
      }
      this.broadcast('chips_update', { seatId: p.seatId, chips: p.chips });
    }

    // 2. 根据结果类型推进
    if (result.type === 'continue') {
      this.game.currentSeat = result.currentSeat;
      this.broadcastGameState();
      this.startActionTimer(result.currentSeat);
    } else if (result.type === 'round_end') {
      // 翻/转/河牌，向前端广播发牌事件触发动画
      this.broadcast('deal_community', { cards: result.communityCards });
      this.game.currentSeat = result.currentSeat;
      this.broadcastGameState();
      this.startActionTimer(result.currentSeat);
    } else if (result.type === 'hand_end') {
      this.saveAndSettleHand();
    }
  }

  /**
   * 动作倒计时托管与管理
   */
  startActionTimer(seatId) {
    this.clearActionTimer();

    // 1. 给被激活的玩家私发 your_turn 事件，提供其专有的下注滑块范围
    this.sendTurnNotificationToSeat(seatId);

    const seat = this.seats[seatId];
    const isOffline = !!(seat && seat.socketIds.size === 0);
    const timeoutMs = isOffline ? 2000 : config.ACTION_TIMEOUT_MS;

    // 2. 设定超时自动动作
    this.timer = setTimeout(() => {
      console.log(`[Table] 座位 ${seatId} 行动超时，触发自动托管`);
      const player = this.game._playerBySeat(seatId);
      if (!player) return;

      const callAmount = this.game.currentBet - player.currentBet;
      const isFreeToCheck = callAmount === 0;

      this.clearActionTimer();
      let result;
      if (isFreeToCheck) {
        result = this.game.act(seatId, { type: 'check' });
        this.broadcast('player_action', { seatId, action: 'check', amount: 0 });
        this.handleGameEngineResult(result, seatId, { type: 'check' });
      } else {
        result = this.game.act(seatId, { type: 'fold' });
        this.broadcast('player_action', { seatId, action: 'fold', amount: 0 });
        this.handleGameEngineResult(result, seatId, { type: 'fold' });
      }
    }, timeoutMs);
  }

  clearActionTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 专发单座位 your_turn
   */
  sendTurnNotificationToSeat(seatId) {
    const seat = this.seats[seatId];
    if (!seat) return;
    for (const socketId of seat.socketIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        this.sendTurnNotificationToSocket(socket, seatId);
      }
    }
  }

  sendTurnNotificationToSocket(socket, seatId) {
    if (!this.game) return;
    const player = this.game._playerBySeat(seatId);
    if (!player) return;

    const callAmount = this.game.currentBet - player.currentBet;
    const canRaise = player.chips > callAmount;

    const seat = this.seats[seatId];
    const isOffline = !!(seat && seat.socketIds.size === 0);
    const timeLimit = isOffline ? 2 : Math.floor(config.ACTION_TIMEOUT_MS / 1000);

    socket.emit('your_turn', {
      callAmount: Math.min(callAmount, player.chips),
      minRaise: canRaise ? Math.min(this.game.currentBet + this.game.minRaise, player.chips + player.currentBet) : 0,
      maxRaise: canRaise ? (player.chips + player.currentBet) : 0,
      timeLimit: timeLimit
    });
  }

  /**
   * 结算并落库手牌历史
   */
  saveAndSettleHand() {
    this.clearActionTimer();
    const endedAt = Date.now();
    const results = this.game.results;

    console.log(`[Table] 手牌结束，结算原因: ${results.reason}`);

    // 1. 同步物理 Seats 上的本地筹码数据
    for (const p of this.game.players) {
      if (this.seats[p.seatId]) {
        this.seats[p.seatId].chips = p.chips;
      }
    }

    // 2. 映射构建持久化数据，执行 SQLite 原子事务
    try {
      const playersData = this.game.players.map(p => {
        const sum = results.summary.find(s => s.seatId === p.seatId);
        return {
          id: p.id, // user_id
          profit: sum ? sum.profit : 0,
          chipsAfter: p.chips,
          result: sum ? sum.result : 'push',
          holeCards: p.holeCards
        };
      });

      db.saveHandResults(
        this.game.handId,
        endedAt,
        playersData,
        this.game.actionLog,
        this.game.communityCards
      );
      console.log(`[Table] 手牌 ${this.game.handId} 历史成功入库`);
    } catch (err) {
      console.error('[Table] 结算入库失败:', err);
    }

    // 3. 提取赢家文字，广播手牌结算结果
    const winners = results.summary.filter(s => s.won > 0).map(s => s.username);
    const winnerText = winners.length > 0 ? winners.join(', ') : null;
    const totalWinnings = results.summary.reduce((s, p) => s + p.won, 0);

    this.broadcast('hand_result', {
      winner: winnerText,
      pot: totalWinnings,
      hands: results.hands
    });

    // 持续广播最终的 showdown 摊牌状态，以便前端可以顺利翻开对手手牌
    this.broadcastGameState();

    // 4. 重置本手实例，延迟 6 秒后启动下一手
    this.game = null;
    this.notifyAdmin();
    setTimeout(() => {
      // 彻底断线的玩家若在此刻不在手牌里，移除其座位
      this.cleanupOfflinePlayers();
      this.syncLobbyState();
      this.checkAutoStart();
    }, 6000);
  }

  /**
   * 清理彻底断线并不在手牌中的玩家座位
   */
  cleanupOfflinePlayers() {
    this.seats.forEach((seat, idx) => {
      if (seat && seat.socketIds.size === 0) {
        console.log(`[Table] 手牌结束后，清理掉彻底断线玩家 ${seat.username} 的物理座位 ${idx}`);
        this.seats[idx] = null;
        this.broadcast('player_left', { seatId: idx });
      }
    });

    // 从旁观者中选择空座补齐
    this.spectators.forEach((spec, socketId) => {
      const emptyIdx = this.seats.indexOf(null);
      if (emptyIdx !== -1) {
        this.spectators.delete(socketId);
        this.seats[emptyIdx] = {
          userId: spec.userId,
          username: spec.username,
          chips: spec.chips,
          socketIds: new Set([socketId])
        };
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.data.seatId = emptyIdx;
        }
        console.log(`[Table] 补齐空位：旁观玩家 ${spec.username} 坐入物理座位 ${emptyIdx}`);
        this.broadcast('player_joined', {
          seatId: emptyIdx,
          username: spec.username,
          chips: spec.chips,
          totalCount: this.getSeatedCount()
        });
      }
    });
  }

  /**
   * 广播实时游戏快照
   */
  broadcastGameState() {
    if (!this.game) return;
    const baseState = this.game.getPublicState();
    
    // 给桌上所有活跃 Socket 重塑广播特定视图
    for (const socket of this.getAllSockets()) {
      const viewerSeatId = socket.data.seatId;
      // 仅私发给自己可看底牌的状态
      const stateForViewer = this.game.getPublicState(viewerSeatId);
      this.sendToSocket(socket, 'game_state', stateForViewer);
    }
    this.notifyAdmin();
  }

  /**
   * 同步在线大厅玩家状态广播 (兼容旧 app.js lobby_state 数据流)
   */
  syncLobbyState() {
    const seen = new Map();
    // 汇总 seated + spectating 形成大厅去重列表
    this.seats.forEach(seat => {
      if (seat && !seen.has(seat.userId)) {
        seen.set(seat.userId, { username: seat.username, chips: seat.chips });
      }
    });
    this.spectators.forEach(spec => {
      if (!seen.has(spec.userId)) {
        seen.set(spec.userId, { username: spec.username, chips: spec.chips });
      }
    });

    const players = Array.from(seen.values());
    this.broadcast('lobby_state', { players, count: players.length });
    this.notifyAdmin();
  }

  /**
   * 翻译公共状态字段至以 viewer 为视角 0 的相对状态
   */
  translateToRelative(data, viewerSeatId) {
    if (viewerSeatId === null || viewerSeatId === undefined) return data;
    if (!data || typeof data !== 'object') return data;
    
    const clone = JSON.parse(JSON.stringify(data));

    const translateGameState = (state) => {
      if (!state) return;
      if (state.currentSeat !== null && state.currentSeat !== undefined) {
        state.currentSeat = (state.currentSeat - viewerSeatId + 6) % 6;
      }
      if (state.dealerSeat !== null && state.dealerSeat !== undefined) {
        state.dealerSeat = (state.dealerSeat - viewerSeatId + 6) % 6;
      }
      if (Array.isArray(state.players)) {
        state.players.forEach(p => {
          const absSeat = p.seatId;
          p.seatId = (absSeat - viewerSeatId + 6) % 6;
          p.isDealer = absSeat === state.dealerSeat;
        });
        state.players.sort((a, b) => a.seatId - b.seatId);
      }
      if (state.results) {
        if (Array.isArray(state.results.summary)) {
          state.results.summary.forEach(s => {
            const absSeat = s.seatId;
            s.seatId = (absSeat - viewerSeatId + 6) % 6;
          });
        }
        if (state.results.hands && typeof state.results.hands === 'object') {
          const relHands = {};
          for (const [absSeatStr, handData] of Object.entries(state.results.hands)) {
            const absSeat = parseInt(absSeatStr, 10);
            const relSeat = (absSeat - viewerSeatId + 6) % 6;
            relHands[relSeat] = handData;
          }
          state.results.hands = relHands;
        }
      }
    };

    // 1. 如果本身是一个全量 game_state 快照
    if (clone.phase !== undefined && Array.isArray(clone.players)) {
      translateGameState(clone);
    }
    // 2. 如果是包裹在 state 内部的数据（形如 new_hand 格式）
    else if (clone.state && clone.state.phase !== undefined && Array.isArray(clone.state.players)) {
      translateGameState(clone.state);
    }

    // 3. 处理根级 seatId (例如 player_action / player_joined / chips_update)
    if (clone.seatId !== undefined && clone.seatId !== null) {
      const originalSeatId = data.seatId;
      clone.seatId = (originalSeatId - viewerSeatId + 6) % 6;
      if (clone.isHero !== undefined) {
        clone.isHero = (originalSeatId === viewerSeatId);
      }
    }

    return clone;
  }

  /**
   * 获取房间内当前所有连接中的活跃 Socket 实例
   */
  getAllSockets() {
    const list = [];
    this.seats.forEach(seat => {
      if (seat) {
        seat.socketIds.forEach(socketId => {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) list.push(socket);
        });
      }
    });
    this.spectators.forEach(spec => {
      if (spec.socket) list.push(spec.socket);
    });
    return list;
  }

  _enrichOfflineStatus(state) {
    if (!state || !Array.isArray(state.players)) return;
    state.players.forEach(p => {
      const seat = this.seats.find(s => s && s.username === p.username);
      if (seat) {
        p.isOffline = (seat.socketIds.size === 0);
      } else {
        p.isOffline = false;
      }
    });
  }

  /**
   * 发送相对转换后的事件至指定 Socket
   */
  sendToSocket(socket, event, data) {
    const viewerSeatId = socket.data.seatId;
    let relData = data;
    if (data && typeof data === 'object') {
      if (event === 'game_state' || event === 'new_hand') {
        relData = JSON.parse(JSON.stringify(data));
        if (event === 'game_state') {
          this._enrichOfflineStatus(relData);
        } else if (relData.state) {
          this._enrichOfflineStatus(relData.state);
        }
      }
    }
    relData = this.translateToRelative(relData, viewerSeatId);
    socket.emit(event, relData);
  }

  /**
   * 广播相对转换后的事件至当前所有连接的 Sockets
   */
  broadcast(event, data) {
    for (const socket of this.getAllSockets()) {
      this.sendToSocket(socket, event, data);
    }
  }

  kickPlayer(username) {
    const targetName = String(username).toLowerCase();
    const seatIndex = this.seats.findIndex(s => s && s.username.toLowerCase() === targetName);
    if (seatIndex === -1) {
      // 检查旁观者
      let kickedSpec = false;
      for (const [socketId, spec] of this.spectators.entries()) {
        if (spec.username.toLowerCase() === targetName) {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit('error', { message: '你已被管理员移出游戏' });
            socket.disconnect(true);
          }
          this.spectators.delete(socketId);
          kickedSpec = true;
        }
      }
      if (kickedSpec) {
        this.syncLobbyState();
        return true;
      }
      return false;
    }

    const seat = this.seats[seatIndex];
    if (seat) {
      console.log(`[Table] 管理员踢出玩家: ${username} (座位 ${seatIndex})`);
      
      // 1. 断开所有相关 socket
      for (const socketId of Array.from(seat.socketIds)) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('error', { message: '你已被管理员移出游戏' });
          socket.disconnect(true);
        }
      }

      // 2. 如果游戏正在进行中，且该玩家还在手牌中
      if (this.game && this.game.phase !== 'ended') {
        const player = this.game._playerBySeat(seatIndex);
        if (player && player.status === 'active') {
          // 如果当前正好轮到该玩家行动，通过正常引擎接口推进游戏进程
          if (this.game.currentSeat === seatIndex) {
            this.clearActionTimer();
            try {
              const result = this.game.act(seatIndex, { type: 'fold' });
              this.broadcast('player_action', { seatId: seatIndex, action: 'fold', amount: 0 });
              this.handleGameEngineResult(result, seatIndex, { type: 'fold' });
            } catch (err) {
              console.error('[Table] 踢人强制弃牌推进失败:', err.message);
              player.status = 'folded';
            }
          } else {
            // 如果不是该玩家的回合，直接在引擎中标记为 folded
            player.status = 'folded';
            this.broadcast('player_action', { seatId: seatIndex, action: 'fold', amount: 0 });
            
            // 检查只剩一个 active 玩家的情况以推进局终（防止局卡死）
            const activePlayers = this.game.players.filter(p => p.status === 'active');
            if (activePlayers.length <= 1) {
              try {
                const result = this.game._afterAction();
                this.handleGameEngineResult(result, seatIndex, { type: 'fold' });
              } catch (e) {
                console.error('[Table] 踢人非回合内局推进失败:', e.message);
              }
            }
          }
        }
      }

      // 3. 清空座位并广播
      this.seats[seatIndex] = null;
      this.broadcast('player_left', { seatId: seatIndex });
      this.syncLobbyState();
      this.checkAutoStart();
      return true;
    }
    return false;
  }

  notifyAdmin() {
    if (this.io) {
      this.io.of('/admin').emit('admin_game_state', this.getAdminState());
    }
  }

  getAdminState() {
    // 1. 获取物理座位状态（不进行相对转换，暴露绝对座位）
    const onlinePlayers = this.seats.map((seat, seatId) => {
      if (!seat) return null;
      return {
        seatId,
        username: seat.username,
        chips: seat.chips,
        isOffline: seat.socketIds.size === 0,
      };
    }).filter(Boolean);

    // 2. 获取旁观者名单
    const spectatorsList = [];
    const seenSpecIds = new Set();
    for (const spec of this.spectators.values()) {
      if (!seenSpecIds.has(spec.userId)) {
        seenSpecIds.add(spec.userId);
        spectatorsList.push({
          username: spec.username,
          chips: spec.chips,
        });
      }
    }

    // 3. 获取实时扑克引擎快照（明牌！）
    let gameState = null;
    if (this.game) {
      const pot = this.game.players.reduce((s, p) => s + p.totalBet, 0);
      gameState = {
        handId:         this.game.handId,
        phase:          this.game.phase,
        pot,
        communityCards: this.game.communityCards.slice(),
        currentSeat:    this.game.currentSeat,
        currentBet:     this.game.currentBet,
        minRaise:       this.game.minRaise,
        smallBlind:     this.game.smallBlind,
        bigBlind:       this.game.bigBlind,
        dealerSeat:     this.game.dealerSeat,
        results:        this.game.results,
        players: this.game.players.map(p => ({
          seatId:    p.seatId,
          username:  p.username,
          chips:     p.chips,
          status:    p.status,
          bet:       p.currentBet,
          totalBet:  p.totalBet,
          isDealer:  p.seatId === this.game.dealerSeat,
          holeCards: p.holeCards.slice(), // 绝对明牌暴露给管理员！
        })),
      };
    }

    // 4. 从数据库获取最近 10 手手牌结算摘要和系统级统计
    let recentHistory = [];
    let systemStats = { totalUsers: 0, totalChips: 0 };
    try {
      // 聚合按 hand_id 分组的局历史
      recentHistory = db.prepare(`
        SELECT 
          hand_id, 
          datetime(MAX(ended_at)/1000, 'unixepoch', 'localtime') as ended_at, 
          GROUP_CONCAT(username || '(' || (case when profit >= 0 then '+' else '' end) || profit || ')') as summary 
        FROM hand_history 
        JOIN users ON users.id = hand_history.user_id 
        GROUP BY hand_id 
        ORDER BY MAX(ended_at) DESC 
        LIMIT 10
      `).all();

      const userCountRow = db.prepare('SELECT COUNT(*) as count FROM users').get();
      const chipSumRow = db.prepare('SELECT SUM(chips) as sum FROM users').get();
      systemStats.totalUsers = userCountRow ? userCountRow.count : 0;
      systemStats.totalChips = chipSumRow ? chipSumRow.sum : 0;
    } catch (e) {
      console.error('[AdminState] 查询数据库失败:', e);
    }

    return {
      gameState,
      onlinePlayers,
      spectators: spectatorsList,
      recentHistory,
      systemStats,
    };
  }

  adjustPlayerChips(username, amount) {
    const targetName = String(username).toLowerCase();
    
    // 1. 查询数据库中该玩家是否存在
    const user = db.prepare('SELECT id, username, chips FROM users WHERE LOWER(username) = ?').get(targetName);
    if (!user) {
      return { success: false, message: `未找到玩家 ${username}` };
    }
    
    const realUsername = user.username; // 拿真实的大小写用户名
    const newChips = user.chips + amount;
    
    // 2. 更新数据库
    db.prepare('UPDATE users SET chips = ? WHERE id = ?').run(newChips, user.id);
    
    // 3. 更新大厅旁观者（如果他在旁观）
    for (const [socketId, spec] of this.spectators.entries()) {
      if (spec.username.toLowerCase() === targetName) {
        spec.chips = newChips;
      }
    }
    
    // 4. 更新物理座位上的筹码（如果他已落座）
    const seatIndex = this.seats.findIndex(s => s && s.username.toLowerCase() === targetName);
    if (seatIndex !== -1) {
      this.seats[seatIndex].chips = newChips;
      // 广播给所有人，让他们知道该座位筹码变了
      this.broadcast('chips_update', { seatId: seatIndex, chips: newChips });
    }
    
    // 5. 更新德州引擎中的筹码（如果游戏正在打且他在打）
    if (this.game && this.game.phase !== 'ended') {
      const enginePlayer = this.game.players.find(p => p.username.toLowerCase() === targetName);
      if (enginePlayer) {
        enginePlayer.chips += amount;
      }
    }
    
    // 6. 全局弹窗广播给所有人！
    this.broadcast('global_notification', {
      type: 'buyin',
      username: realUsername,
      seatId: seatIndex,
      addedAmount: amount,
      totalChips: newChips,
      message: `管理员为玩家 <strong>[${realUsername}]</strong> 额外Buyin充值了 <strong>${amount}</strong> 筹码！<br>当前总筹码量为 <strong>${newChips}</strong>。`
    });
    
    // 7. 同步大厅状态和管理员状态
    this.syncLobbyState();
    this.notifyAdmin();
    
    console.log(`[Table] 管理员充值: 玩家 ${realUsername} +${amount} 筹码，当前总计: ${newChips}`);
    return { success: true, message: `成功为玩家 ${realUsername} 充值 ${amount} 筹码，当前一共有 ${newChips}` };
  }
}

// 导出全局 Table 状态机单例
module.exports = new Table();
