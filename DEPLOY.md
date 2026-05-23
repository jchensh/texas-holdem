# ♠️ Poker Night 生产环境部署与运维白皮书 (Step 10)

本手册专为 **Poker Night** 德州扑克联机游戏在 **谷歌云 (GCP) 香港虚拟机实例 (Compute Engine VM)** 上的生产级上线提供全流程、保姆式的搭建与日常运维指导。

---

## 目录
1. [基础软硬件准备与安全组配置](#1-基础软硬件准备与安全组配置)
2. [第一阶段：服务器基础软环境搭建](#2-第一阶段服务器基础软环境搭建)
3. [第二阶段：代码部署与一键平滑启动](#3-第二阶段代码部署与一键平滑启动)
4. [第三阶段：Nginx 代理与 Certbot SSL 加密极速实操](#4-第三阶段nginx-代理与-certbot-ssl-加密极速实操)
5. [第四阶段：SQLite 数据库生产运维与夜间热备份方案](#5-第四阶段sqlite-数据库生产运维与夜间热备份方案)
6. [生产环境高频故障诊断与排查字典](#6-生产环境高频故障诊断与排查字典)

---

## 1. 基础软硬件准备与安全组配置

### 1.1 推荐硬件与系统配置
*   **区域 (Region)**: 谷歌云香港 (GCP asia-east2)。
*   **配置**: 1 核 CPU，1G ~ 2G 内存（如 `e2-micro` / `e2-small` 实例即绰绰有余）。
*   **操作系统**: 强烈推荐 **Ubuntu 22.04 LTS / 24.04 LTS** 或 **Debian 12 (Bookworm)**。

### 1.2 谷歌云防火墙安全组放行规则
在部署之前，必须进入 **GCP 控制台 $\rightarrow$ VPC 网络 $\rightarrow$ 防火墙**，确认或新建以下入站防火墙规则：

| 规则名称 | 协议端口 | 来源 IP | 目标 Tag | 作用 |
| :--- | :--- | :--- | :--- | :--- |
| `allow-ssh` | TCP:22 | `0.0.0.0/0` | 应用于该实例 | SSH 远程登录连接与维护 |
| `allow-http` | TCP:80 | `0.0.0.0/0` | 应用于该实例 | 常规访问与 SSL 证书验证 |
| `allow-https` | TCP:443 | `0.0.0.0/0` | 应用于该实例 | 加密的 HTTPS 访问与安全 WebSocket |

> [!CAUTION]
> ⚠️ **安全警告**：千万不要在安全组中开放 `3000` (Node 原始端口) 或 `3010` (管理 socket 端口，若独立) 的公网访问。Nginx 会在本地进行安全反代，直接暴露 Node 端口会面临越过 Nginx 发生 DDOS 或越权扫描的安全风险。

---

## 2. 第一阶段：服务器基础软环境搭建

连接到您的 GCP 香港 VM 终端（通过 SSH），依次执行以下命令以完成服务器基础环境的零起步安装。

### 2.1 更新系统与安装基础编译库
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ufw dirmngr apt-transport-https lsb-release ca-certificates
```

### 2.2 安装 Node.js v20 LTS
使用 NodeSource 官方源安装，保证与本地开发测试环境一致：
```bash
# 下载并导入 NodeSource 官方签名 GPG 密钥与仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 安装 Node.js
sudo apt install -y nodejs

# 验证安装
node -v  # 应输出 v20.x.x
npm -v   # 应输出 v10.x.x
```

### 2.3 安装全局 PM2 进程守护工具
```bash
sudo npm install -g pm2
pm2 -v
```

### 2.4 安装 Nginx 网页服务
```bash
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## 3. 第二阶段：代码部署与一键平滑启动

### 3.1 创建应用存放根目录并授权
规范生产环境存放路径，避免在 `/root` 下运行。我们使用 `/var/www/poker-night` 作为官方规范目录：
```bash
# 创建目录
sudo mkdir -p /var/www/poker-night

# 将该目录的所有权移交给当前登录的非 root 用户 (例如您的常用登录用户名 ubuntu)
sudo chown -R $USER:$USER /var/www/poker-night
```

### 3.2 拉取/克隆代码
在当前用户身份下，将项目分支拉取到服务器中：
```bash
cd /var/www/poker-night
git clone -b next https://github.com/jchensh/texas-holdem.git .
```

### 3.3 配置文件就位与 Session 安全防泄漏修改
```bash
# 基于模板复制配置文件
cp .env.example .env

# 编辑配置文件
nano .env
```
> [!IMPORTANT]
> 在打开的 `.env` 交互框中，**必须**将 `SESSION_SECRET` 的默认值修改为一个高强度的随机防伪造私密字符串。可以使用以下命令在终端快速生成并填入：
> ```bash
> openssl rand -hex 32  # 将生成的 64 位十六进制字符填入 .env 的 SESSION_SECRET 中
> ```

### 3.4 赋权并执行全自动部署脚本
我们已为您编写好全自动依赖精简、权限配置、PM2 启动与自存盘的一键脚本 `scripts/deploy.sh`：
```bash
# 赋予执行权限
chmod +x scripts/deploy.sh

# 运行部署脚本
./scripts/deploy.sh
```

### 3.5 配置 PM2 开机自动拉起与守护 (极其重要)
为了防止系统因内核升级、云盘维护等原因意外重启导致游戏服务瘫痪，必须将 PM2 服务挂载至系统 `systemd` 中：
```bash
# 1. 运行 startup 指令，它会根据您的系统环境生成一行带有 sudo 的开机脚本
pm2 startup
```
> **注意**：拷贝 `pm2 startup` 运行后在终端最下方输出的那行长指令（包含 `sudo env PATH=...`），在终端中粘贴并按回车运行！
```bash
# 2. 将当前运行的 poker-night 进程列表状态存盘锁定
pm2 save
```

---

## 4. 第三阶段：Nginx 代理与 Certbot SSL 加密极速实操

Nginx 会拦截 80/443 端口流量，为前端文件开启高比例 Gzip 压缩分发，并将通信流量及 Websocket 握手协议完美转发至本地 PM2 运行的 3000 端口。

### 4.1 挂载 Nginx 代理配置文件
```bash
# 1. 将项目自带的 nginx.conf 软链接到 Nginx 的站点配置目录中
sudo ln -sf /var/www/poker-night/poker-night.nginx.conf /etc/nginx/sites-enabled/poker-night

# 2. 检查 Nginx 系统自带的 default 配置是否占用，若有，建议删除默认配置软链以防冲突
sudo rm -f /etc/nginx/sites-enabled/default

# 3. 审计 Nginx 配置文件的语法正确性
sudo nginx -t  # 提示 syntax is ok 即可
```

### 4.2 申请免费的 Let's Encrypt SSL 加密证书 (推荐模式 A)
我们使用 Certbot 自动化工具快速在 10 秒内完成 HTTPS 证书绑定，它会自动重写我们编写的 `poker-night.nginx.conf` 配置文件：
```bash
# 1. 安装 certbot 与 nginx 联动插件
sudo apt install -y certbot python3-certbot-nginx

# 2. 执行自动申请，请将 poker.yourdomain.com 替换为您的真实解析域名
sudo certbot --nginx -d poker.yourdomain.com
```
*   *操作指引*：
    *   在交互提示中输入您的邮箱（用于接收到期警告）。
    *   同意服务条款。
    *   在询问是否强制将 HTTP 流量重定向到 HTTPS 时，选择 **`2: Redirect`**。

### 4.3 极速重载 Nginx
```bash
sudo systemctl reload nginx
log_success "Nginx 服务已安全重载生效！"
```
现在，在浏览器访问 `https://poker.yourdomain.com`，您就可以体验加载极其流畅、且带有安全 HTTPS 加密锁标志的德州扑克了！

### 4.4 自动续签配置
Let's Encrypt 证书有效期为 90 天。Certbot 在安装时会自动为您在系统 `cron` 中挂载续签检测脚本。您可以通过以下命令验证续签服务是否正常：
```bash
sudo certbot renew --dry-run  # 确认无报错即可，系统每天会自动静默运行两次续签检测
```

---

## 5. 第四阶段：SQLite 数据库生产运维与夜间热备份方案

由于 `better-sqlite3` 是单文件轻量级数据库，它的数据完全保存在单个 `data/poker.db` 文件中。虽然非常敏捷，但也需要防止物理硬盘损坏或服务器丢失导致的数据损毁。

### 5.1 零阻塞物理热备份脚本
SQLite WAL 模式支持在手牌进行、数据写入的期间，以零阻塞的形式导出快照热备份。我们提供一个生产级定时备份脚本 `scripts/backup-db.sh`：

在项目根目录下创建该文件：
```bash
nano scripts/backup-db.sh
```
填入以下备份逻辑：
```bash
#!/usr/bin/env bash
# =========================================================================
# SQLite 数据库夜间零阻塞热备份脚本
# =========================================================================
set -euo pipefail

DB_DIR="/var/www/poker-night/data"
BACKUP_DIR="/var/www/poker-night/backups"

# 创建备份归档目录
mkdir -p "${BACKUP_DIR}"

# 生成时间戳文件名
BACKUP_FILE="${BACKUP_DIR}/poker-backup-$(date +%F_%H%M%S).db"

# 执行 sqlite3 零阻塞在线热备份指令
sqlite3 "${DB_DIR}/poker.db" ".backup '${BACKUP_FILE}'"

# 保留最近 14 天的备份，自动清理陈旧备份以防磁盘爆满
find "${BACKUP_DIR}" -name "poker-backup-*.db" -type f -mtime +14 -exec rm -f {} \;

echo "SQLite 数据库已于 $(date) 成功备份至 ${BACKUP_FILE}"
```
保存并赋予该备份脚本执行权限：
```bash
chmod +x scripts/backup-db.sh
```

### 5.2 挂载 Crontab 凌晨 3 点自动热备份
在 VM 终端执行以下配置：
```bash
# 打开当前用户的 crontab 配置文件
crontab -e
```
在文件最底部追加以下一行（代表每天凌晨 3:00 自动执行一次热备份，并输出日志）：
```cron
0 3 * * * /var/www/poker-night/scripts/backup-db.sh >> /var/www/poker-night/backups/backup.log 2>&1
```

---

## 6. 生产环境高频故障诊断与排查字典

### 🛑 6.1 访问时网页提示 `502 Bad Gateway`
*   **原因分析**：Nginx 服务正在安全运行，但后端的 Node.js / PM2 服务处于离线状态，或者监听的端口不是 3000。
*   **排查步骤**：
    1.  运行 `pm2 list` 确认 `poker-night` 应用的 `status` 是 `online`。
    2.  若是 `errored` 状态，运行 `pm2 logs poker-night` 查看报错堆栈。通常是因为 `.env` 权限缺失、或者端口被抢占。
    3.  若 PM2 运行正常，检查 `/var/www/poker-night/.env` 中配置的 `PORT` 是否确实为 `3000`。

### 🛑 6.2 能够进入认证和战绩视图，但进入牌桌后提示“等待玩家”，且控制台报错或不停重连
*   **原因分析**：
    1.  **WebSocket 协议转发缺失**：在 Nginx 配置文件中，针对 `/socket.io/` 路径的升级协议标头（`Upgrade` 与 `Connection`）配置被意外遗漏或修改。
    2.  **HTTPS 下的安全混合阻断**：当您用 HTTPS（443 端口）打开了网页，但 Socket.IO 尝试用不安全的 `ws://`（而不是加密的 `wss://`）握手时，浏览器安全沙箱会出于 Mixed Content 策略进行强行拦截。
*   **解决方案**：
    1.  确保您的网页与握手协议统一使用 HTTPS，并在 Nginx 配置文件中仔细检查是否包含了 `proxy_set_header Upgrade $http_upgrade;` 等 3 行核心标头。
    2.  在前端 App 的 `socket.js` 中使用 `io({ withCredentials: true })` 让同源 cookie 自动被 WebSocket 共享。

### 🛑 6.3 玩家在刷新页面或意外重连后，筹码量丢失或账号异常登出
*   **原因分析**：
    1.  **Session 密钥不一致**：PM2 在多进程或重启后，若未提供静态固定的 `SESSION_SECRET`，每次均会随机生成一个密钥，导致原本客户端已有的 Cookie-Session HMAC 签名校验失败被迫登出。
    2.  **Cookie 缺少安全属性**：在 HTTPS 环境下，由于代理路径未配置 `proxy_set_header X-Forwarded-Proto $scheme;`，导致服务器读取的协议类型与实际不一致，从而使安全 Cookie 被意外丢弃。
*   **解决方案**：
    1.  确认 `/var/www/poker-night/.env` 中的 `SESSION_SECRET` 已硬编码配置为您自定义的固定高强度安全字符，不可使用默认占位符。

---
