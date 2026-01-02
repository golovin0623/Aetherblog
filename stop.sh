#!/bin/bash

# AetherBlog 一键停止脚本
# 停止所有正在运行的服务

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$PROJECT_ROOT/.pids"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           🛑 AetherBlog 停止脚本                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# 停止服务
stop_service() {
    local name=$1
    local pid_file="$PID_DIR/$name.pid"
    
    if [ -f "$pid_file" ]; then
        PID=$(cat "$pid_file")
        
        if ps -p $PID > /dev/null 2>&1; then
            echo -e "${YELLOW}正在停止 $name (PID: $PID)...${NC}"
            kill $PID 2>/dev/null || true
            
            # 等待进程结束
            for i in {1..10}; do
                if ! ps -p $PID > /dev/null 2>&1; then
                    break
                fi
                sleep 0.5
            done
            
            # 强制杀死
            if ps -p $PID > /dev/null 2>&1; then
                kill -9 $PID 2>/dev/null || true
            fi
            
            rm -f "$pid_file"
            echo -e "${GREEN}✅ $name 已停止${NC}"
        else
            rm -f "$pid_file"
            echo -e "${YELLOW}⚠️  $name 未在运行${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  $name PID 文件不存在${NC}"
    fi
}

# 停止占用端口的进程
stop_by_port() {
    local port=$1
    local name=$2
    
    PID=$(lsof -ti :$port 2>/dev/null || true)
    
    if [ -n "$PID" ]; then
        echo -e "${YELLOW}正在停止 $name (端口: $port, PID: $PID)...${NC}"
        kill $PID 2>/dev/null || true
        sleep 1
        
        if lsof -ti :$port > /dev/null 2>&1; then
            kill -9 $(lsof -ti :$port) 2>/dev/null || true
        fi
        
        echo -e "${GREEN}✅ $name 已停止${NC}"
    fi
}

# 停止中间件 (Docker)
stop_middleware() {
    echo -e "${BLUE}[5/5] 停止中间件服务...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ -f "docker-compose.yml" ]; then
        if docker compose ps 2>/dev/null | grep -q "running"; then
            docker compose down
            echo -e "${GREEN}✅ 中间件服务已停止${NC}"
        else
            echo -e "${YELLOW}⚠️  中间件服务未在运行${NC}"
        fi
    fi
}

# 主流程
main() {
    STOP_ALL=false
    
    # 解析参数
    while [[ "$#" -gt 0 ]]; do
        case $1 in
            --all) STOP_ALL=true ;;
            *) echo "未知参数: $1" ;;
        esac
        shift
    done

    echo -e "${BLUE}[1/5] 停止后端服务...${NC}"
    stop_service "backend"
    stop_by_port 8080 "后端 API"
    
    echo ""
    echo -e "${BLUE}[2/5] 停止博客前台...${NC}"
    stop_service "blog"
    stop_by_port 3000 "博客前台"
    
    echo ""
    echo -e "${BLUE}[3/5] 停止管理后台...${NC}"
    stop_service "admin"
    stop_by_port 5173 "管理后台"
    
    echo ""
    echo -e "${BLUE}[4/5] 清理 Node 进程...${NC}"
    pkill -f "next dev" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    echo -e "${GREEN}✅ 清理完成${NC}"
    
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
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
}

main "$@"

