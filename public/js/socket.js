/**
 * Socket.IO 事件接口
 *
 * 所有与后端的实时通信都通过这里。
 * 认证：cookie-session 同源请求时浏览器自动带 cookie，无需在 connect() 中传 token。
 *
 * 服务端期望接收的事件（emit）：
 *   action        { type: 'fold'|'check'|'call'|'raise', amount?: number }
 *   ready         无参数
 *   join_table    { tableId: string }
 *
 * 服务端会推送的事件（on）：
 *   lobby_state   { players: [{username, chips}], count } — 大厅玩家变化
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

let socket = null;

const SocketClient = {

  /** 建立连接（cookie-session 自动带，无需 token） */
  connect() {
    if (socket && socket.connected) return;
    // 同源连接；Socket.IO 会自动把 document.cookie 带在握手请求上
    socket = io({ withCredentials: true });
    this._bindEvents();
  },

  /** 断开连接 */
  disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  },

  /** 向服务器发送操作 */
  emit: {
    fold()        { socket && socket.emit('action', { type: 'fold' }); },
    check()       { socket && socket.emit('action', { type: 'check' }); },
    call()        { socket && socket.emit('action', { type: 'call' }); },
    raise(amount) { socket && socket.emit('action', { type: 'raise', amount }); },
    ready()       { socket && socket.emit('ready'); },
    joinTable(tableId) { socket && socket.emit('join_table', { tableId }); },
    showHand()    { socket && socket.emit('show_hand'); },
  },

  /** 绑定服务端推送事件，调用 App 的更新函数 */
  _bindEvents() {
    socket.on('connect',    () => console.log('[Socket] 已连接', socket.id));
    socket.on('disconnect', (reason) => console.log('[Socket] 连接断开:', reason));
    socket.on('connect_error', (err) => {
      console.error('[Socket] 握手失败:', err.message);
      App.showError('实时连接失败：' + err.message);
    });

    socket.on('lobby_state', (data) => App.updateLobby(data));

    // 以下事件由 step 5/6 游戏引擎触发，先把通道铺好
    socket.on('game_state',     (data) => App.updateGameState(data));
    socket.on('new_hand',       (data) => { App.startNewHand(); App.updateGameState(data.state); });
    socket.on('deal_community', (data) => App.dealCommunityCards(data.cards));
    socket.on('player_action',  (data) => App.onPlayerAction(data));
    socket.on('your_turn',      (data) => App.showActionPanel(data));
    socket.on('hand_result',    (data) => App.showHandResult(data));
    socket.on('player_joined',  (data) => App.onPlayerJoined(data));
    socket.on('player_left',    (data) => App.clearPlayerSeat(data.seatId));
    socket.on('chips_update',   (data) => App.updateChips(data));
    socket.on('error',          (data) => App.showError(data.message));
    socket.on('global_notification', (data) => App.showGlobalNotification(data));
    socket.on('player_show_hand', (data) => App.onPlayerShowHand(data));
    socket.on('avatar_update',  (data) => App.onAvatarUpdate(data));
  },
};
