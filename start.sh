#!/bin/bash

# AetherBlog 一键启动脚本
# 启动后端服务、前端博客和管理后台

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
PID_DIR="$PROJECT_ROOT/.pids"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 创建目录
mkdir -p "$LOG_DIR" "$PID_DIR"

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           🚀 AetherBlog 一键启动脚本              ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# 检查依赖
check_dependencies() {
    echo -e "${YELLOW}[1/6] 检查依赖...${NC}"
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker 未安装，无法启动中间件${NC}"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js 未安装${NC}"
        exit 1
    fi
    
    if ! command -v pnpm &> /dev/null; then
        echo -e "${YELLOW}⚠️  pnpm 未安装，正在安装...${NC}"
        npm install -g pnpm
    fi
    
    echo -e "${GREEN}✅ 依赖检查通过${NC}"
}

# 启动中间件 (Docker)
start_middleware() {
    echo -e "${YELLOW}[2/6] 启动中间件服务 (Docker)...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ -f "docker-compose.yml" ]; then
        # 检查 Docker 是否在运行
        if ! docker info &> /dev/null; then
            echo -e "${RED}❌ Docker 未运行，请先启动 Docker Desktop${NC}"
            exit 1
        fi
        
        # 检查并清理异常退出的容器（防止端口残留）
        EXITED_CONTAINERS=$(docker compose ps -a --filter "status=exited" -q 2>/dev/null || true)
        if [ -n "$EXITED_CONTAINERS" ]; then
            echo -e "${BLUE}   清理异常退出的容器...${NC}"
            docker compose rm -f $EXITED_CONTAINERS 2>/dev/null || true
        fi
        
        # 启动容器
        docker compose up -d
        
        # 等待服务就绪
        echo -e "${BLUE}   等待中间件服务就绪...${NC}"
        sleep 5
        
        # 检查服务状态
        if docker compose ps | grep -q "running"; then
            echo -e "${GREEN}✅ 中间件服务已启动 (PostgreSQL, Redis, Elasticsearch)${NC}"
        else
            echo -e "${YELLOW}⚠️  部分中间件可能未完全启动，请检查 docker compose ps${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  未找到 docker-compose.yml，跳过中间件启动${NC}"
    fi
}

# 安装依赖
install_deps() {
    echo -e "${YELLOW}[3/6] 安装项目依赖...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ ! -d "node_modules" ] || [ ! -f "pnpm-lock.yaml" ]; then
        pnpm install
    else
        echo -e "${GREEN}✅ 依赖已安装${NC}"
    fi
}

# 启动后端 (如果存在 Maven 项目)
start_backend() {
    echo -e "${YELLOW}[4/6] 启动后端服务...${NC}"
    
    BACKEND_DIR="$PROJECT_ROOT/apps/server"
    
    if [ -f "$BACKEND_DIR/pom.xml" ]; then
        if command -v mvn &> /dev/null; then
            cd "$BACKEND_DIR"
            
            # 检查是否已在运行
            if [ -f "$PID_DIR/backend.pid" ]; then
                PID=$(cat "$PID_DIR/backend.pid")
                if ps -p $PID > /dev/null 2>&1; then
                    echo -e "${YELLOW}⚠️  后端已在运行 (PID: $PID)${NC}"
                    return
                fi
            fi
            
            # 编译并启动
            echo -e "${BLUE}   编译后端项目...${NC}"
            mvn clean package -DskipTests -q 2>&1 | tail -5
            
            # 查找可执行 JAR 文件 (优先 aetherblog-app，其次 blog-service)
            JAR_FILE=$(find . -name "aetherblog-app*.jar" -path "*/target/*" ! -name "*-sources.jar" 2>/dev/null | head -1)
            if [ -z "$JAR_FILE" ]; then
                JAR_FILE=$(find . -name "blog-service*.jar" -path "*/target/*" ! -name "*-sources.jar" 2>/dev/null | head -1)
            fi
            
            if [ -n "$JAR_FILE" ]; then
                echo -e "${BLUE}   启动后端服务: $JAR_FILE${NC}"
                nohup java -jar "$JAR_FILE" > "$LOG_DIR/backend.log" 2>&1 &
                echo $! > "$PID_DIR/backend.pid"
                sleep 3  # 等待服务启动
                if ps -p $! > /dev/null 2>&1; then
                    echo -e "${GREEN}✅ 后端服务已启动 (PID: $!)${NC}"
                else
                    echo -e "${YELLOW}⚠️  后端服务启动后退出，请检查日志: $LOG_DIR/backend.log${NC}"
                    tail -10 "$LOG_DIR/backend.log" 2>/dev/null || true
                fi
            else
                echo -e "${YELLOW}⚠️  未找到可执行 JAR 文件，跳过后端启动${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  Maven 未安装，跳过后端启动${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  未找到后端项目，跳过${NC}"
    fi
}

# 启动前端博客
start_blog() {
    echo -e "${YELLOW}[5/6] 启动博客前台...${NC}"
    
    BLOG_DIR="$PROJECT_ROOT/apps/blog"
    
    if [ -f "$BLOG_DIR/package.json" ]; then
        cd "$BLOG_DIR"
        
        # 检查是否已在运行
        if [ -f "$PID_DIR/blog.pid" ]; then
            PID=$(cat "$PID_DIR/blog.pid")
            if ps -p $PID > /dev/null 2>&1; then
                echo -e "${YELLOW}⚠️  博客前台已在运行 (PID: $PID)${NC}"
                return
            fi
        fi
        
        # 安装依赖并启动
        pnpm install --silent
        nohup pnpm dev > "$LOG_DIR/blog.log" 2>&1 &
        echo $! > "$PID_DIR/blog.pid"
        echo -e "${GREEN}✅ 博客前台已启动 (PID: $!) - http://localhost:3000${NC}"
    else
        echo -e "${YELLOW}⚠️  未找到博客项目${NC}"
    fi
}

# 启动管理后台
start_admin() {
    echo -e "${YELLOW}[6/6] 启动管理后台...${NC}"
    
    ADMIN_DIR="$PROJECT_ROOT/apps/admin"
    
    if [ -f "$ADMIN_DIR/package.json" ]; then
        cd "$ADMIN_DIR"
        
        # 检查是否已在运行
        if [ -f "$PID_DIR/admin.pid" ]; then
            PID=$(cat "$PID_DIR/admin.pid")
            if ps -p $PID > /dev/null 2>&1; then
                echo -e "${YELLOW}⚠️  管理后台已在运行 (PID: $PID)${NC}"
                return
            fi
        fi
        
        # 安装依赖并启动
        pnpm install --silent
        nohup pnpm dev > "$LOG_DIR/admin.log" 2>&1 &
        echo $! > "$PID_DIR/admin.pid"
        echo -e "${GREEN}✅ 管理后台已启动 (PID: $!) - http://localhost:5173${NC}"
    else
        echo -e "${YELLOW}⚠️  未找到管理后台项目${NC}"
    fi
}

# 显示状态
show_status() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}🎉 AetherBlog 启动完成!${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  📝 博客前台: ${GREEN}http://localhost:3000${NC}"
    echo -e "  ⚙️  管理后台: ${GREEN}http://localhost:5173${NC}"
    echo -e "  🔧 后端 API: ${GREEN}http://localhost:8080${NC}"
    echo ""
    echo -e "  📁 日志目录: $LOG_DIR"
    echo -e "  🛑 停止命令: ./stop.sh"
    echo ""
}

# 主流程
main() {
    check_dependencies
    start_middleware
    install_deps
    start_backend
    start_blog
    start_admin
    show_status
}

main
