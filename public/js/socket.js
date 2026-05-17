/**
 * Socket.IO 事件接口
 *
 * 所有与后端的实时通信都通过这里。
 * 后端实现后，取消各处注释，接入真实 socket 连接。
 *
 * 服务端期望接收的事件（emit）：
 *   action        { type: 'fold'|'check'|'call'|'raise', amount?: number }
 *   ready         无参数
 *   join_table    { tableId: string }
 *
 * 服务端会推送的事件（on）：
 *   game_state    GameState     — 全量状态快照
 *   new_hand      { state }     — 新一手牌开始
 *   deal_community { cards }   — 翻/转/河牌
 *   player_action { seatId, action, amount } — 某玩家行动通知
 *   your_turn     { callAmount, minRaise, maxRaise, timeLimit } — 轮到自己
 *   hand_result   { winner, pot, hands }   — 手牌结算
 *   player_joined { seatId, username, chips }
 *   player_left   { seatId }
 *   chips_update  { seatId, chips, isHero }
 *   error         { message }
 */

// let socket; // 取消注释后由 connect() 赋值

const SocketClient = {

  /** 建立连接，传入认证 token */
  connect(token) {
    // socket = io({ auth: { token } });
    // this._bindEvents();
    console.log('[Socket] connect 占位符，token:', token);
  },

  /** 断开连接 */
  disconnect() {
    // socket.disconnect();
    console.log('[Socket] disconnect 占位符');
  },

  /** 向服务器发送操作 */
  emit: {
    fold() {
      // socket.emit('action', { type: 'fold' });
      console.log('[Socket] emit → fold');
    },
    check() {
      // socket.emit('action', { type: 'check' });
      console.log('[Socket] emit → check');
    },
    call() {
      // socket.emit('action', { type: 'call' });
      console.log('[Socket] emit → call');
    },
    raise(amount) {
      // socket.emit('action', { type: 'raise', amount });
      console.log('[Socket] emit → raise', amount);
    },
    ready() {
      // socket.emit('ready');
      console.log('[Socket] emit → ready');
    },
    joinTable(tableId) {
      // socket.emit('join_table', { tableId });
      console.log('[Socket] emit → join_table', tableId);
    },
  },

  /** 绑定服务端推送事件，调用 App 的更新函数 */
  _bindEvents() {
    // socket.on('connect',    () => console.log('[Socket] 已连接'));
    // socket.on('disconnect', () => App.showError('连接断开，请刷新页面'));

    // socket.on('game_state',     (data) => App.updateGameState(data));
    // socket.on('new_hand',       (data) => { App.startNewHand(); App.updateGameState(data.state); });
    // socket.on('deal_community', (data) => App.dealCommunityCards(data.cards));
    // socket.on('player_action',  (data) => App.onPlayerAction(data));
    // socket.on('your_turn',      (data) => App.showActionPanel(data));
    // socket.on('hand_result',    (data) => App.showHandResult(data));
    // socket.on('player_joined',  (data) => App.onPlayerJoined(data));
    // socket.on('player_left',    (data) => App.clearPlayerSeat(data.seatId));
    // socket.on('chips_update',   (data) => App.updateChips(data));
    // socket.on('error',          (data) => App.showError(data.message));

    console.log('[Socket] _bindEvents 占位符');
  },
};
