/**
 * Socket.IO 管理员命名空间 (Namespace) 与实时日志中心
 */
const table = require('./table');

// 日志缓冲与配置
const logBuffer = [];
const MAX_LOGS = 150;
let adminNamespaceInstance = null;
let isLoggingGuard = false;

// 备份原生的 console 方法
const originalLog = console.log;
const originalError = console.error;

// 日志处理与推送逻辑 (带防循环重入锁)
function addLog(type, args) {
  if (isLoggingGuard) return;
  isLoggingGuard = true;
  try {
    const message = args.map(arg => {
      if (arg === null) return 'null';
      if (arg === undefined) return 'undefined';
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const logEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    };

    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_LOGS) {
      logBuffer.shift();
    }

    if (adminNamespaceInstance) {
      adminNamespaceInstance.emit('admin_log', logEntry);
    }
  } catch (err) {
    // 默默捕获任何异常，防止中断原有的程序输出
  } finally {
    isLoggingGuard = false;
  }
}

// 重写全局 console 管道
console.log = function(...args) {
  originalLog.apply(console, args);
  addLog('info', args);
};

console.error = function(...args) {
  originalError.apply(console, args);
  addLog('error', args);
};

module.exports = {
  init(io) {
    adminNamespaceInstance = io.of('/admin');

    // 鉴权中间件：只有带管理员登录态的 session 才能连入该命名空间
    adminNamespaceInstance.use((socket, next) => {
      const session = socket.request.session;
      if (session && session.isAdmin) {
        return next();
      }
      const err = new Error('未授权：需要管理员登录');
      err.data = { code: 'UNAUTHORIZED' };
      next(err);
    });

    adminNamespaceInstance.on('connection', (socket) => {
      // 使用原始 console.log 防止触发 Socket 内部日志再次广播
      originalLog.apply(console, [`[AdminSocket] 管理员已连接: ${socket.id}`]);
      
      // 1. 刚连上时立即向该管理员推送当前的最全状态快照
      socket.emit('admin_game_state', table.getAdminState());
      
      // 2. 立即推送最近的历史日志数据
      socket.emit('admin_log_history', logBuffer);
      
      // 3. 监听管理员发起的踢人动作
      socket.on('admin_kick', (data) => {
        const { username } = data;
        if (!username) return;
        
        originalLog.apply(console, [`[AdminSocket] 收到管理员踢人指令, 目标: ${username}`]);
        const success = table.kickPlayer(username);
        
        // 反馈结果给操作人
        socket.emit('admin_action_result', {
          action: 'kick',
          username,
          success,
          message: success ? `已成功将玩家 ${username} 移出牌桌` : `未找到玩家 ${username}`
        });
      });

      // 4. 监听管理员调整筹码动作（正数为加、负数为减；0 不合法）
      socket.on('admin_adjust_chips', (data) => {
        const { username, amount } = data;
        const parseAmount = parseInt(amount, 10);
        if (!username || isNaN(parseAmount) || parseAmount === 0) {
          return socket.emit('admin_action_result', {
            action: 'adjust_chips',
            success: false,
            message: '筹码调整数额不合法（需为非零整数，正数加、负数减）'
          });
        }

        originalLog.apply(console, [`[AdminSocket] 收到管理员筹码调整指令, 目标: ${username}, 数额: ${parseAmount}`]);
        const result = table.adjustPlayerChips(username, parseAmount);

        // 反馈结果给操作人
        socket.emit('admin_action_result', {
          action: 'adjust_chips',
          username,
          success: result.success,
          message: result.message
        });
      });

      // 5. 监听管理员删除玩家动作（级联清理账号与手牌历史）
      socket.on('admin_delete_player', (data) => {
        const { username } = data;
        if (!username) return;

        originalLog.apply(console, [`[AdminSocket] 收到管理员删除玩家指令, 目标: ${username}`]);
        const result = table.deletePlayer(username);

        socket.emit('admin_action_result', {
          action: 'delete_player',
          username,
          success: result.success,
          message: result.message
        });
      });

      socket.on('disconnect', () => {
        originalLog.apply(console, [`[AdminSocket] 管理员连接断开: ${socket.id}`]);
      });
    });
    
    originalLog.apply(console, ['[AdminSocket] 管理员 Socket.IO 命名空间已成功挂载，系统日志拦截就绪 (/admin)']);
  }
};
