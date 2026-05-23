#!/usr/bin/env bash

# =========================================================================
# Poker Night 生产环境全自动一键部署与平滑重启脚本 (deploy.sh)
# =========================================================================
# 提示: 在 Linux 上运行前需先赋予执行权限：chmod +x scripts/deploy.sh
# =========================================================================

# 开启报错即停，遇到未定义的变量即停，管道报错即停
set -euo pipefail

# 带有华丽前缀的控制台彩色输出函数
log_info() {
    echo -e "\033[1;34m[INFO]\033[0m $1"
}

log_warn() {
    echo -e "\033[1;33m[WARN]\033[0m $1"
}

log_error() {
    echo -e "\033[1;31m[ERROR]\033[0m $1"
}

log_success() {
    echo -e "\033[1;32m[SUCCESS]\033[0m $1"
}

# 导航至项目根目录
cd "$(dirname "$0")/.."
PROJECT_DIR=$(pwd)
log_info "进入项目工作根目录: ${PROJECT_DIR}"

# -------------------------------------------------------------------------
# 1. 基础系统环境依赖性校验
# -------------------------------------------------------------------------
log_info "正在校验系统环境与依赖..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    log_error "未检测到 Node.js 运行环境！请先安装 Node.js (推荐 v20+)。"
    exit 1
fi
NODE_VERSION=$(node -v)
log_success "Node.js 已就绪: ${NODE_VERSION}"

# 检查 NPM
if ! command -v npm &> /dev/null; then
    log_error "未检测到 npm 包管理工具！"
    exit 1
fi

# 检查 Nginx
if ! command -v nginx &> /dev/null; then
    log_warn "未检测到 Nginx 服务！若本地仅做测试可忽略，若生产运行请确保系统已安装并启动 Nginx。"
else
    log_success "Nginx 已安装就绪。"
fi

# 检查并尝试自恢复全局 PM2
if ! command -v pm2 &> /dev/null; then
    log_warn "未检测到 PM2 进程守护工具。正在尝试全局为您安装 pm2..."
    if ! npm install -g pm2; then
        log_error "全局安装 PM2 失败，请尝试使用 'sudo npm install -g pm2' 进行手动安装。"
        exit 1
    fi
fi
PM2_VERSION=$(pm2 -v)
log_success "PM2 守护已就绪: v${PM2_VERSION}"

# -------------------------------------------------------------------------
# 2. 生产环境配置文件配置 (.env)
# -------------------------------------------------------------------------
log_info "正在检查生产环境配置 (.env)..."
if [ ! -f ".env" ]; then
    log_warn "未检测到 .env 配置文件！"
    if [ -f ".env.example" ]; then
        log_info "已自动为您基于 .env.example 复制生成 .env"
        cp .env.example .env
        log_warn "⚠️  请注意：当前已生成默认的 .env，但您必须编辑该文件，修改 'SESSION_SECRET' 值为一个高强度、安全的私密字符串！"
    else
        log_error "缺失 .env.example 模板，无法初始化 .env，请检查代码库完整性。"
        exit 1
    fi
else
    # 检查是否仍在使用默认的 dev session
    if grep -q "dev-only-change-me-in-prod" .env; then
        log_warn "⚠️  警告：您的 .env 中依旧包含默认的 'dev-only-change-me-in-prod' 会话密钥！请尽快将其修改为保密密钥。"
    else
        log_success ".env 配置文件验证通过。"
    fi
fi

# -------------------------------------------------------------------------
# 3. 目录创建与文件写盘权限配置
# -------------------------------------------------------------------------
log_info "正在校验并建立 SQLite 数据存储目录..."
mkdir -p data
# 确保当前执行用户对该目录具有安全的读写权限（ better-sqlite3 需要创建 WAL 与 Shm 临时文件）
chmod 755 data
log_success "数据存储目录已就绪: ${PROJECT_DIR}/data"

# -------------------------------------------------------------------------
# 4. 依赖精简安装 (Pruning dependencies)
# -------------------------------------------------------------------------
log_info "正在采用安全一致性模式安装 Node.js 生产依赖包..."
# 使用 ci 能够锁定 package-lock 并完全擦除无关的 devDependencies，大幅降低磁盘开销与安全漏洞
npm ci --omit=dev
log_success "生产环境依赖包安装成功。"

# -------------------------------------------------------------------------
# 5. PM2 进程平滑加载 (Zero-Downtime Reload)
# -------------------------------------------------------------------------
log_info "正在通过 PM2 启动/重载 Poker Night 服务进程..."

# 使用 startOrReload 读取 ecosystem.config.js。如果进程已存在，执行零停机平滑重新加载
if pm2 reload ecosystem.config.js --env production &> /dev/null; then
    log_success "PM2 进程已成功零停机平滑重载！"
else
    log_info "检测到服务当前未在运行，正在全新初始化启动进程..."
    pm2 start ecosystem.config.js --env production
    log_success "PM2 进程已成功初始化并运行！"
fi

# 自动保存 PM2 进程状态以防服务器重启后进程丢失
pm2 save
log_success "已将 PM2 进程状态保存入库。"

# -------------------------------------------------------------------------
# 6. 后续部署指引汇总
# -------------------------------------------------------------------------
echo -e "\n========================================================================="
log_success "★★ Poker Night 服务端核心代码已成功完成自动部署！ ★★"
echo -e "========================================================================="
log_info "以下是您的线上运行指引："
echo -e "  1. 确认 Node 服务状态："
echo -e "     \033[1;36mpm2 status\033[0m (当前运行列表)"
echo -e "     \033[1;36mpm2 logs poker-night\033[0m (查看实时系统控制台控制输出)"
echo -e "  2. 启用 Nginx 反向代理配置："
echo -e "     * 请将项目目录下的 \033[1;32mpoker-night.nginx.conf\033[0m 移入您的 Nginx 站点配置目录中"
echo -e "     * 软链生效: \033[1;36msudo ln -s /var/www/poker-night/poker-night.nginx.conf /etc/nginx/sites-enabled/\033[0m"
echo -e "     * 测试并重载 Nginx: \033[1;36msudo nginx -t && sudo systemctl reload nginx\033[0m"
echo -e "  3. 配置 PM2 开机自动拉起守护服务 (极其重要)："
echo -e "     * 请在命令行运行 \033[1;36mpm2 startup\033[0m 并拷贝系统给出的那行命令（带有 sudo env ...）并在终端粘贴执行！"
echo -e "=========================================================================\n"
