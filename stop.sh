#!/bin/bash

# AetherBlog 一键停止脚本
# 停止所有正在运行的服务
#
# 用法:
#   ./stop.sh         # 停止应用服务 (保留中间件)
#   ./stop.sh --all   # 停止所有服务 (包括中间件)
#   ./stop.sh --force # 强制停止 (忽略进程校验/全局清理)

set -euo pipefail
IFS=$'\n\t'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/shutdown.log"
PID_DIR="$PROJECT_ROOT/.pids"
LOCK_DIR="$PROJECT_ROOT/.locks"
LOCK_NAME="stop"
LOCK_PATH="$LOCK_DIR/$LOCK_NAME.lock"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 默认参数
STOP_ALL=false
STOP_FORCE=false
LAST_STOP_RESULT=""

# 创建目录 + 停止日志
mkdir -p "$LOG_DIR" "$PID_DIR" "$LOCK_DIR"
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           🛑 AetherBlog 停止脚本                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# 安全读取 PID
read_pid() {
    local pid_file=$1
    local pid
    pid=$(cat "$pid_file" 2>/dev/null || true)
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
        echo "$pid"
        return 0
    fi
    return 1
}

# 兼容 docker compose / docker-compose
docker_compose() {
    if docker compose version > /dev/null 2>&1; then
        docker compose "$@"
        return
    fi
    if command -v docker-compose > /dev/null 2>&1; then
        docker-compose "$@"
        return
    fi
    echo -e "${RED}❌ 未找到 docker compose，请安装 Docker Desktop 或 docker-compose${NC}"
    return 1
}

# 获取进程工作目录 (macOS/Linux)
get_process_cwd() {
    local pid=$1
    if command -v lsof > /dev/null 2>&1; then
        lsof -p "$pid" -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'
        return 0
    fi
    if command -v pwdx > /dev/null 2>&1; then
        pwdx "$pid" 2>/dev/null | awk '{print $2}'
        return 0
    fi
    return 1
}

# 防止并发停止
acquire_lock() {
    if mkdir "$LOCK_PATH" 2>/dev/null; then
        echo $$ > "$LOCK_PATH/pid"
        trap 'rm -rf "$LOCK_PATH"' EXIT
        return
    fi

    if [ -f "$LOCK_PATH/pid" ]; then
        local lock_pid
        lock_pid=$(cat "$LOCK_PATH/pid" 2>/dev/null || true)
        if [ -n "$lock_pid" ] && ps -p "$lock_pid" > /dev/null 2>&1; then
            echo -e "${RED}❌ 停止脚本已在运行 (PID: $lock_pid)${NC}"
            exit 1
        fi
        rm -rf "$LOCK_PATH"
        mkdir "$LOCK_PATH"
        echo $$ > "$LOCK_PATH/pid"
        trap 'rm -rf "$LOCK_PATH"' EXIT
        return
    fi

    echo -e "${RED}❌ 无法获取停止锁，请检查 $LOCK_PATH${NC}"
    exit 1
}

# 判断进程是否匹配预期
should_stop_cmd() {
    local cmd=$1
    local pattern=$2
    local name=$3
    local pid=$4

    if [ "$STOP_FORCE" = true ] || [ -z "$pattern" ]; then
        return 0
    fi
    if [[ "$cmd" == *"$pattern"* ]]; then
        return 0
    fi
    local cwd
    cwd=$(get_process_cwd "$pid" 2>/dev/null || true)
    if [ -n "$cwd" ] && [[ "$cwd" == *"$pattern"* ]]; then
        return 0
    fi
    echo -e "${YELLOW}⚠️  $name 进程与预期不匹配，跳过停止 (使用 --force 可强制)${NC}"
    return 1
}

# 停止指定 PID
stop_pid() {
    local pid=$1
    local name=$2

    echo -e "${YELLOW}正在停止 $name (PID: $pid)...${NC}"
    kill "$pid" 2>/dev/null || true

    for i in {1..10}; do
        if ! ps -p "$pid" > /dev/null 2>&1; then
            break
        fi
        sleep 0.5
    done

    if ps -p "$pid" > /dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
    fi
}

# 停止服务
stop_service() {
    local name=$1
    local pattern=${2:-}
    local pid_file="$PID_DIR/$name.pid"
    LAST_STOP_RESULT="no_pid"
    
    if [ -f "$pid_file" ]; then
        if PID=$(read_pid "$pid_file"); then
            if ps -p "$PID" > /dev/null 2>&1; then
                local cmd
                cmd=$(ps -p "$PID" -o command= 2>/dev/null || true)
                if should_stop_cmd "$cmd" "$pattern" "$name" "$PID"; then
                    stop_pid "$PID" "$name"
                    rm -f "$pid_file"
                    echo -e "${GREEN}✅ $name 已停止${NC}"
                    LAST_STOP_RESULT="stopped"
                else
                    LAST_STOP_RESULT="skipped"
                fi
            else
                rm -f "$pid_file"
                echo -e "${YELLOW}⚠️  $name 未在运行${NC}"
                LAST_STOP_RESULT="not_running"
            fi
        else
            rm -f "$pid_file"
            echo -e "${YELLOW}⚠️  $name PID 文件无效，已清理${NC}"
            LAST_STOP_RESULT="invalid_pid"
        fi
    else
        echo -e "${YELLOW}⚠️  $name PID 文件不存在${NC}"
        LAST_STOP_RESULT="no_pid"
    fi
}

# 停止占用端口的进程
stop_by_port() {
    local port=$1
    local name=$2
    local pattern=${3:-}

    local pids
    pids=$(lsof -ti ":$port" 2>/dev/null || true)

    if [ -z "$pids" ]; then
        return
    fi

    for pid in $pids; do
        if ! ps -p "$pid" > /dev/null 2>&1; then
            continue
        fi
        local cmd
        cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
        if should_stop_cmd "$cmd" "$pattern" "$name" "$pid"; then
            stop_pid "$pid" "$name (端口: $port)"
            echo -e "${GREEN}✅ $name 已停止${NC}"
        fi
    done
}

# 停止网关
stop_gateway() {
    echo -e "${BLUE}[6/6] 停止网关...${NC}"

    # Docker 未运行时，跳过网关容器停止，避免影响 Docker 服务
    if ! docker info &> /dev/null; then
        echo -e "${YELLOW}⚠️  Docker 未运行，跳过网关容器停止${NC}"
        return
    fi

    # 停止通过 docker 启动的网关容器
    if docker ps --filter "name=aetherblog-gateway" --format '{{.Names}}' | grep -q "aetherblog-gateway"; then
        docker stop aetherblog-gateway 2>/dev/null || true
        docker rm aetherblog-gateway 2>/dev/null || true
        echo -e "${GREEN}✅ 网关已停止${NC}"
    else
        echo -e "${YELLOW}⚠️  网关未在运行${NC}"
    fi
}

# 停止中间件 (Docker)
stop_middleware() {
    echo -e "${BLUE}[7/7] 停止中间件服务...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ -f "docker-compose.yml" ]; then
        if ! docker info &> /dev/null; then
            echo -e "${YELLOW}⚠️  Docker 未运行，跳过中间件停止${NC}"
            return
        fi
        if docker_compose ps 2>/dev/null | grep -q "running"; then
            docker_compose down
            echo -e "${GREEN}✅ 中间件服务已停止${NC}"
        else
            echo -e "${YELLOW}⚠️  中间件服务未在运行${NC}"
        fi
    fi
}

# 主流程
main() {
    # 解析参数
    while [[ "$#" -gt 0 ]]; do
        case $1 in
            --all) STOP_ALL=true ;;
            --force|-f) STOP_FORCE=true ;;
            *) echo "未知参数: $1" ;;
        esac
        shift
    done

    acquire_lock

    echo -e "${BLUE}[1/6] 停止后端服务...${NC}"
    stop_service "backend" "$PROJECT_ROOT/apps/server"
    if [ "$LAST_STOP_RESULT" != "stopped" ] && [ "$LAST_STOP_RESULT" != "skipped" ]; then
        stop_by_port 8080 "后端 API" "$PROJECT_ROOT/apps/server"
    fi
    
    echo ""
    echo -e "${BLUE}[2/6] 停止 AI 服务...${NC}"
    stop_service "ai-service" "$PROJECT_ROOT/apps/ai-service"
    if [ "$LAST_STOP_RESULT" != "stopped" ] && [ "$LAST_STOP_RESULT" != "skipped" ]; then
        stop_by_port 8000 "AI 服务" "$PROJECT_ROOT/apps/ai-service"
    fi

    echo ""
    echo -e "${BLUE}[3/6] 停止博客前台...${NC}"
    stop_service "blog" "$PROJECT_ROOT/apps/blog"
    if [ "$LAST_STOP_RESULT" != "stopped" ] && [ "$LAST_STOP_RESULT" != "skipped" ]; then
        stop_by_port 3000 "博客前台" "$PROJECT_ROOT/apps/blog"
    fi
    
    echo ""
    echo -e "${BLUE}[4/6] 停止管理后台...${NC}"
    stop_service "admin" "$PROJECT_ROOT/apps/admin"
    if [ "$LAST_STOP_RESULT" != "stopped" ] && [ "$LAST_STOP_RESULT" != "skipped" ]; then
        stop_by_port 5173 "管理后台" "$PROJECT_ROOT/apps/admin"
    fi
    
    echo ""
    echo -e "${BLUE}[5/6] 清理 Node 进程...${NC}"
    if [ "$STOP_FORCE" = true ]; then
        pkill -f "next dev" 2>/dev/null || true
        pkill -f "vite" 2>/dev/null || true
        echo -e "${GREEN}✅ 清理完成${NC}"
    else
        echo -e "${YELLOW}⚠️  跳过全局清理 (使用 --force 可强制清理)${NC}"
    fi
    
    echo ""
    stop_gateway
    
    # 如果传入 --all 参数，同时停止中间件
    if [ "$STOP_ALL" = true ]; then
        echo ""
        stop_middleware
    else
        echo ""
        echo -e "${YELLOW}提示: 使用 ./stop.sh --all 同时停止中间件服务${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}🎉 所有服务已停止!${NC}"
    echo -e "${BLUE}📄 停止日志: $LOG_FILE${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
}

main "$@"
