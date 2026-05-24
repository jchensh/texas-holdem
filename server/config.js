/**
 * 服务端配置常量
 * 环境变量优先，开发默认值后置。
 */
const path = require('path');

module.exports = {
  // 服务
  PORT:     parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Session（cookie-session 用 HMAC 签名，密钥泄漏 = 任意伪造登录态）
  SESSION_SECRET:     process.env.SESSION_SECRET || 'dev-only-change-me-in-prod',
  SESSION_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,  // 30 天

  // SQLite 数据库
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'poker.db'),

  // 游戏参数（step 4+ 起使用）
  STARTING_CHIPS:    1000,
  SMALL_BLIND:       5,
  BIG_BLIND:         10,
  ACTION_TIMEOUT_MS: 30 * 1000,

  // 单桌容量（V2：扩为最多 10 人入座）
  MAX_SEATS:  10,  // 物理座位数，全部可入座下注
  MAX_ONLINE: 10,  // 房间最大在线人数（坐下 + 旁观）
};
