#!/bin/bash

# AetherBlog 一键启动脚本
# 启动后端服务、前端博客和管理后台
# 
# 用法:
#   ./start.sh                 # 开发模式 (直接访问各端口)
#   ./start.sh --gateway       # 开发网关模式 (测试网关路由，保留热更新)
#   ./start.sh --prod          # 生产模式 (通过网关统一入口)
#   ./start.sh --with-middleware  # 同时启动中间件 (PostgreSQL/Redis/ES)

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
PID_DIR="$PROJECT_ROOT/.pids"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # 无颜色

# 默认参数
PROD_MODE=false
GATEWAY_MODE=false
START_MIDDLEWARE=false

# 解析参数
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --prod) PROD_MODE=true ;;
        --gateway) GATEWAY_MODE=true ;;
        --with-middleware) START_MIDDLEWARE=true ;;
        --no-middleware) START_MIDDLEWARE=false ;;
        -h|--help) 
            echo "用法: ./start.sh [选项]"
            echo "选项:"
            echo "  --gateway 开发网关模式 (测试网关路由，保留热更新)"
            echo "  --prod    生产模式 (通过网关统一入口 :7899)"
            echo "  --with-middleware 启动中间件 (PostgreSQL/Redis/ES)"
            echo "  --no-middleware   不启动中间件 (默认)"
            echo "  -h,--help 显示帮助"
            exit 0
            ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
    shift
done

# 创建目录
mkdir -p "$LOG_DIR" "$PID_DIR"

if [ "$PROD_MODE" = true ]; then
    echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║      🚀 AetherBlog 生产模式启动 (含网关)          ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
elif [ "$GATEWAY_MODE" = true ]; then
    echo -e "${YELLOW}╔═══════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║    🚀 AetherBlog 开发网关模式启动 (测试路由)      ║${NC}"
    echo -e "${YELLOW}╚═══════════════════════════════════════════════════╝${NC}"
else
    echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║           🚀 AetherBlog 开发模式启动              ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
fi
echo ""

# 检查依赖
check_dependencies() {
    echo -e "${YELLOW}[1/7] 检查依赖...${NC}"
    
    if [ "$START_MIDDLEWARE" = true ] || [ "$PROD_MODE" = true ] || [ "$GATEWAY_MODE" = true ]; then
        if ! command -v docker &> /dev/null; then
            echo -e "${RED}❌ Docker 未安装，无法启动中间件/网关${NC}"
            exit 1
        fi
    fi
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js 未安装${NC}"
        exit 1
    fi
    
    if ! command -v pnpm &> /dev/null; then
        echo -e "${YELLOW}⚠️  pnpm 未安装，正在安装...${NC}"
        npm install -g pnpm
    fi
    
    if command -v python3 &> /dev/null; then
        PYTHON_BIN="python3"
    elif command -v python &> /dev/null; then
        PYTHON_BIN="python"
    else
        echo -e "${RED}❌ Python 未安装 (AI 服务需要)${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ 依赖检查通过${NC}"
}

# 启动中间件 (Docker)
start_middleware() {
    echo -e "${YELLOW}[2/7] 启动中间件服务 (Docker)...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ "$START_MIDDLEWARE" != true ]; then
        echo -e "${YELLOW}⚠️  默认不启动中间件 (如需请添加 --with-middleware)${NC}"
        return
    fi

    if [ -f "docker-compose.yml" ]; then
        # 检查 Docker 是否在运行
        if ! docker info &> /dev/null; then
            echo -e "${YELLOW}⏳ Docker 未运行，正在启动 Docker Desktop...${NC}"
            
            # 尝试启动 Docker Desktop (macOS)
            if [[ "$OSTYPE" == "darwin"* ]]; then
                open -a Docker
            else
                echo -e "${RED}❌ 请手动启动 Docker${NC}"
                exit 1
            fi
            
            # 等待 Docker 就绪 (最多 60 秒)
            echo -e "${BLUE}   等待 Docker daemon 启动...${NC}"
            local max_wait=60
            local waited=0
            while ! docker info &> /dev/null; do
                if [ $waited -ge $max_wait ]; then
                    echo -e "${RED}❌ Docker 启动超时 (${max_wait}s)，请检查 Docker Desktop${NC}"
                    exit 1
                fi
                sleep 2
                waited=$((waited + 2))
                echo -ne "\r${BLUE}   等待 Docker daemon 启动... ${waited}s${NC}"
            done
            echo ""
            echo -e "${GREEN}✅ Docker Desktop 已就绪${NC}"
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
    echo -e "${YELLOW}[3/7] 安装项目依赖...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ ! -d "node_modules" ] || [ ! -f "pnpm-lock.yaml" ]; then
        pnpm install
    else
        echo -e "${GREEN}✅ 依赖已安装${NC}"
    fi
}

# 启动后端 (如果存在 Maven 项目)
start_backend() {
    echo -e "${YELLOW}[4/7] 启动后端服务...${NC}"
    
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
                nohup java -Dapp.log.path="$LOG_DIR" -DAPP_LOG_PATH="$LOG_DIR" -Dlogging.file.path="$LOG_DIR" -jar "$JAR_FILE" > "$LOG_DIR/backend.log" 2>&1 &
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

# 启动 AI 服务
start_ai_service() {
    echo -e "${YELLOW}[5/7] 启动 AI 服务...${NC}"

    AI_DIR="$PROJECT_ROOT/apps/ai-service"

    if [ -f "$AI_DIR/requirements.txt" ]; then
        if [ -f "$PID_DIR/ai-service.pid" ]; then
            PID=$(cat "$PID_DIR/ai-service.pid")
            if ps -p $PID > /dev/null 2>&1; then
                echo -e "${YELLOW}⚠️  AI 服务已在运行 (PID: $PID)${NC}"
                return
            fi
        fi

        cd "$AI_DIR"

        if [ ! -d ".venv" ]; then
            echo -e "${BLUE}   创建 AI 服务虚拟环境...${NC}"
            $PYTHON_BIN -m venv .venv
        fi

        if [ ! -f ".env" ] && [ -f ".env.example" ]; then
            cp .env.example .env
        fi

        if [ ! -x ".venv/bin/uvicorn" ]; then
            echo -e "${BLUE}   安装 AI 服务依赖...${NC}"
            .venv/bin/pip install -r requirements.txt
        fi

        nohup .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > "$LOG_DIR/ai-service.log" 2>&1 &
        echo $! > "$PID_DIR/ai-service.pid"
        sleep 2

        if ps -p $! > /dev/null 2>&1; then
            echo -e "${GREEN}✅ AI 服务已启动 (PID: $!)${NC}"
        else
            echo -e "${YELLOW}⚠️  AI 服务启动后退出，请检查日志: $LOG_DIR/ai-service.log${NC}"
            tail -10 "$LOG_DIR/ai-service.log" 2>/dev/null || true
        fi
    else
        echo -e "${YELLOW}⚠️  未找到 AI 服务，跳过${NC}"
    fi
}

# 启动前端博客
start_blog() {
    echo -e "${YELLOW}[6/7] 启动博客前台...${NC}"
    
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
    echo -e "${YELLOW}[7/7] 启动管理后台...${NC}"
    
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

# 启动网关
# 参数: $1 - 配置文件 (nginx.dev.conf 或 nginx.conf)
start_gateway() {
    local config_file="${1:-nginx.conf}"
    echo -e "${YELLOW}[8/8] 启动 Nginx 网关...${NC}"
    cd "$PROJECT_ROOT"
    
    # 停止已有网关容器
    docker stop aetherblog-gateway 2>/dev/null || true
    docker rm aetherblog-gateway 2>/dev/null || true
    
    # 启动网关容器
    if [ "$PROD_MODE" = true ]; then
        # 生产模式: 优先使用 docker-compose.prod.yml 的 gateway 服务
        docker compose -f docker-compose.prod.yml up -d gateway 2>/dev/null || {
            docker run -d --name aetherblog-gateway \
                -p 7899:80 \
                -v "$PROJECT_ROOT/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
                --network host \
                nginx:alpine 2>/dev/null || true
        }
    else
        # 开发网关模式: 使用开发配置
        docker run -d --name aetherblog-gateway \
            -p 7899:80 \
            -v "$PROJECT_ROOT/nginx/${config_file}:/etc/nginx/conf.d/default.conf:ro" \
            --add-host=host.docker.internal:host-gateway \
            nginx:alpine
    fi
    
    echo -e "${GREEN}✅ 网关已启动 (端口: 7899, 配置: ${config_file})${NC}"
}

# 显示状态
show_status() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}🎉 AetherBlog 启动完成!${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo ""
    
    if [ "$PROD_MODE" = true ] || [ "$GATEWAY_MODE" = true ]; then
        echo -e "  ${CYAN}🌐 统一入口 (网关): ${GREEN}http://localhost:7899${NC}"
        echo -e "      └─ /        → 博客前台"
        echo -e "      └─ /admin/  → 管理后台"
        echo -e "      └─ /api     → 后端 API"
        echo ""
        if [ "$GATEWAY_MODE" = true ]; then
            echo -e "  ${YELLOW}📖 开发网关模式说明:${NC}"
            echo -e "      使用 nginx.dev.conf 配置，代理到本地开发服务器"
            echo -e "      热更新仍然可用，适合测试网关路由"
            echo ""
        fi
        echo -e "  ${YELLOW}📌 直接访问端口 (可选):${NC}"
    fi
    
    echo -e "  📝 博客前台: ${GREEN}http://localhost:3000${NC}"
    echo -e "  ⚙️  管理后台: ${GREEN}http://localhost:5173${NC}"
    echo -e "  🔧 后端 API: ${GREEN}http://localhost:8080${NC}"
    echo -e "  🤖 AI 服务: ${GREEN}http://localhost:8000${NC}"
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
    start_ai_service
    start_blog
    start_admin
    
    if [ "$PROD_MODE" = true ]; then
        start_gateway "nginx.conf"
    elif [ "$GATEWAY_MODE" = true ]; then
        start_gateway "nginx.dev.conf"
    fi
    
    show_status
}

main
