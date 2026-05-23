module.exports = {
  apps: [
    {
      name: 'poker-night',
      script: 'server/index.js',
      
      // better-sqlite3 数据库为单文件直连，WAL 模式下多实例进程写盘易引发锁死
      // 故生产环境必须使用 fork 单实例模式，单核 Node.js 足以支持数百并发
      instances: 1,
      exec_mode: 'fork',

      // 生产环境关闭热重载，避免不稳定和高 CPU 抖动
      watch: false,

      // 异常自动重启
      autorestart: true,

      // 内存超过此限度自动平滑重启以解决可能存在的内存泄漏风险
      max_memory_restart: '500M',

      // 生产环境变量配置
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },

      // 日志输出设置 (PM2 默认会将日志输出在 ~/.pm2/logs/ 下)
      // 如果需要，可以在此处指定自定义合并日志，但建议使用 PM2 默认的系统管理
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      combine_logs: true,
      merge_logs: true
    }
  ]
};
