#!/bin/bash

# AetherBlog 一键启动脚本
# 启动后端服务、前端博客和管理后台
# 
# 用法:
#   ./start.sh                 # 开发模式 (直接访问各端口)
#   ./start.sh --gateway       # 开发网关模式 (测试网关路由，保留热更新)
#   ./start.sh --prod          # 生产模式 (通过网关统一入口)
#   ./start.sh --with-middleware  # 同时启动中间件 (PostgreSQL/Redis/ES)
#   ./stop.sh && ./start.sh --gateway --with-middleware    # 开发测试指令

set -euo pipefail
IFS=$'\n\t'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
PID_DIR="$PROJECT_ROOT/.pids"
LOCK_DIR="$PROJECT_ROOT/.locks"
LOCK_NAME="start"
LOCK_PATH="$LOCK_DIR/$LOCK_NAME.lock"
LOG_FILE="$LOG_DIR/startup.log"

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

# 健康检查配置 (可通过环境变量覆盖)
HEALTH_RETRIES=${HEALTH_RETRIES:-3}
HEALTH_RETRY_DELAY=${HEALTH_RETRY_DELAY:-5}
HTTP_TIMEOUT=${HTTP_TIMEOUT:-5}
MIDDLEWARE_RETRIES=${MIDDLEWARE_RETRIES:-3}
MIDDLEWARE_RETRY_DELAY=${MIDDLEWARE_RETRY_DELAY:-5}
MIDDLEWARE_LOG_TAIL=${MIDDLEWARE_LOG_TAIL:-80}
FAILED_SERVICES=()

# 中间件选项
DOCKER_REMOVE_ORPHANS=false
SKIP_ELASTICSEARCH=false
MIDDLEWARE_SERVICES=()
OPTIONAL_MIDDLEWARE_SERVICES=("elasticsearch")

# 判断是否为可选中间件
is_optional_middleware_service() {
    local svc=$1
    local optional
    for optional in "${OPTIONAL_MIDDLEWARE_SERVICES[@]}"; do
        if [ "$svc" = "$optional" ]; then
            return 0
        fi
    done
    return 1
}

# 解析参数
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --prod) PROD_MODE=true ;;
        --gateway) GATEWAY_MODE=true ;;
        --with-middleware) START_MIDDLEWARE=true ;;
        --no-middleware) START_MIDDLEWARE=false ;;
        --remove-orphans) DOCKER_REMOVE_ORPHANS=true ;;
        --skip-elasticsearch) SKIP_ELASTICSEARCH=true ;;
        -h|--help) 
            echo "用法: ./start.sh [选项]"
            echo "选项:"
            echo "  --gateway 开发网关模式 (测试网关路由，保留热更新)"
            echo "  --prod    生产模式 (通过网关统一入口 :7899)"
            echo "  --with-middleware 启动中间件 (PostgreSQL/Redis/ES)"
            echo "  --no-middleware   不启动中间件 (默认)"
            echo "  --remove-orphans  清理 compose 的孤儿容器"
            echo "  --skip-elasticsearch  启动中间件时跳过 Elasticsearch"
            echo "  -h,--help 显示帮助"
            exit 0
            ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
    shift
done

# 创建目录 + 启动日志
mkdir -p "$LOG_DIR" "$PID_DIR" "$LOCK_DIR"
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

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

    if [ "$START_MIDDLEWARE" = true ] || [ "$PROD_MODE" = true ]; then
        if ! docker compose version > /dev/null 2>&1 && ! command -v docker-compose > /dev/null 2>&1; then
            echo -e "${RED}❌ 未找到 docker compose，无法启动中间件/生产网关${NC}"
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

    if ! command -v curl &> /dev/null; then
        echo -e "${RED}❌ curl 未安装，无法进行健康检查${NC}"
        exit 1
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

# 记录启动失败的服务
record_failure() {
    local name=$1
    FAILED_SERVICES+=("$name")
}

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

# 读取中间件服务清单
load_middleware_services() {
    local services
    services=$(docker_compose config --services 2>/dev/null || true)
    if [ -z "$services" ]; then
        return 1
    fi

    local filtered=()
    while IFS= read -r svc; do
        [ -z "$svc" ] && continue
        if [ "$SKIP_ELASTICSEARCH" = true ] && [ "$svc" = "elasticsearch" ]; then
            continue
        fi
        filtered+=("$svc")
    done <<< "$services"

    MIDDLEWARE_SERVICES=("${filtered[@]}")
    return 0
}

# 等待中间件全部 Running
wait_for_middleware() {
    local retries=${1:-$MIDDLEWARE_RETRIES}
    local delay=${2:-$MIDDLEWARE_RETRY_DELAY}

    if [ ${#MIDDLEWARE_SERVICES[@]} -eq 0 ]; then
        if ! load_middleware_services; then
            echo -e "${YELLOW}⚠️  无法读取中间件服务列表，跳过健康检查${NC}"
            return 0
        fi
    fi

    local attempt=1
    local problems_required=()
    local problems_optional=()
    while [ $attempt -le $retries ]; do
        problems_required=()
        problems_optional=()
        for svc in "${MIDDLEWARE_SERVICES[@]}"; do
            local cid status health
            cid=$(docker_compose ps -q "$svc" 2>/dev/null || true)
            if [ -z "$cid" ]; then
                if is_optional_middleware_service "$svc"; then
                    problems_optional+=("$svc:missing")
                else
                    problems_required+=("$svc:missing")
                fi
                continue
            fi
            status=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || true)
            health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null || true)

            if [ "$status" != "running" ]; then
                if is_optional_middleware_service "$svc"; then
                    problems_optional+=("$svc:$status")
                else
                    problems_required+=("$svc:$status")
                fi
                continue
            fi
            if [ -n "$health" ] && [ "$health" != "healthy" ]; then
                if is_optional_middleware_service "$svc"; then
                    problems_optional+=("$svc:$health")
                else
                    problems_required+=("$svc:$health")
                fi
                continue
            fi
        done

        if [ ${#problems_required[@]} -eq 0 ] && [ ${#problems_optional[@]} -eq 0 ]; then
            echo -e "${GREEN}✅ 中间件服务已启动 (${MIDDLEWARE_SERVICES[*]})${NC}"
            return 0
        fi

        local display=()
        if [ ${#problems_required[@]} -gt 0 ]; then
            display+=("${problems_required[@]}")
        fi
        if [ ${#problems_optional[@]} -gt 0 ]; then
            display+=("${problems_optional[@]}")
        fi

        if [ ${#problems_required[@]} -eq 0 ]; then
            echo -e "${YELLOW}⚠️  可选中间件尚未就绪 (${display[*]}) 尝试 ${attempt}/${retries}${NC}"
        else
            echo -e "${YELLOW}⚠️  中间件尚未就绪 (${display[*]}) 尝试 ${attempt}/${retries}${NC}"
        fi
        if [ $attempt -lt $retries ]; then
            sleep "$delay"
        fi
        attempt=$((attempt + 1))
    done

    if [ ${#problems_required[@]} -eq 0 ] && [ ${#problems_optional[@]} -gt 0 ]; then
        echo -e "${YELLOW}⚠️  可选中间件启动超时 (${problems_optional[*]})，将继续启动应用${NC}"
        docker_compose ps 2>/dev/null || true
        for svc in "${MIDDLEWARE_SERVICES[@]}"; do
            if ! is_optional_middleware_service "$svc"; then
                continue
            fi
            local cid status health
            cid=$(docker_compose ps -q "$svc" 2>/dev/null || true)
            if [ -z "$cid" ]; then
                continue
            fi
            status=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || true)
            health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null || true)
            if [ "$status" != "running" ] || { [ -n "$health" ] && [ "$health" != "healthy" ]; }; then
                echo -e "${YELLOW}   ${svc} 最近日志:${NC}"
                docker logs --tail "$MIDDLEWARE_LOG_TAIL" "$cid" 2>/dev/null || true
            fi
        done
        echo -e "${YELLOW}   提示: 可使用 --skip-elasticsearch 跳过 ES；或通过 ELASTICSEARCH_IMAGE 切换 ES 镜像版本后重启容器${NC}"
        return 0
    fi

    echo -e "${RED}❌ 中间件启动超时${NC}"
    docker_compose ps 2>/dev/null || true
    for svc in "${MIDDLEWARE_SERVICES[@]}"; do
        local cid status health
        cid=$(docker_compose ps -q "$svc" 2>/dev/null || true)
        if [ -z "$cid" ]; then
            continue
        fi
        status=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || true)
        health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null || true)
        if [ "$status" != "running" ] || { [ -n "$health" ] && [ "$health" != "healthy" ]; }; then
            echo -e "${RED}   ${svc} 最近日志:${NC}"
            docker logs --tail "$MIDDLEWARE_LOG_TAIL" "$cid" 2>/dev/null || true
        fi
    done
    return 1
}

# 防止并发启动
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
            echo -e "${RED}❌ 启动脚本已在运行 (PID: $lock_pid)${NC}"
            exit 1
        fi
        rm -rf "$LOCK_PATH"
        mkdir "$LOCK_PATH"
        echo $$ > "$LOCK_PATH/pid"
        trap 'rm -rf "$LOCK_PATH"' EXIT
        return
    fi

    echo -e "${RED}❌ 无法获取启动锁，请检查 $LOCK_PATH${NC}"
    exit 1
}

# 进程是否存活 (重试)
wait_for_process() {
    local pid=$1
    local name=$2
    local log_file=$3
    local retries=${4:-$HEALTH_RETRIES}
    local delay=${5:-2}

    local attempt=1
    while [ $attempt -le $retries ]; do
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
        sleep "$delay"
        attempt=$((attempt + 1))
    done

    echo -e "${RED}❌ $name 进程已退出${NC}"
    if [ -n "$log_file" ] && [ -f "$log_file" ]; then
        echo -e "${RED}   最近日志:${NC}"
        tail -n 20 "$log_file" 2>/dev/null || true
    fi
    return 1
}

# HTTP 健康检查 (重试)
wait_for_http() {
    local url=$1
    local name=$2
    local log_file=$3
    local retries=${4:-$HEALTH_RETRIES}
    local delay=${5:-$HEALTH_RETRY_DELAY}

    local attempt=1
    while [ $attempt -le $retries ]; do
        local code
        code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$HTTP_TIMEOUT" "$url" || true)
        if [[ "$code" =~ ^(2|3) ]]; then
            echo -e "${GREEN}✅ $name 健康检查通过${NC}"
            return 0
        fi
        echo -e "${YELLOW}⚠️  $name 健康检查失败 (HTTP $code) 尝试 ${attempt}/${retries}${NC}"
        if [ $attempt -lt $retries ]; then
            sleep "$delay"
        fi
        attempt=$((attempt + 1))
    done

    echo -e "${RED}❌ $name 健康检查失败，已重试 ${retries} 次${NC}"
    if [ -n "$log_file" ] && [ -f "$log_file" ]; then
        echo -e "${RED}   最近日志:${NC}"
        tail -n 20 "$log_file" 2>/dev/null || true
    fi
    return 1
}

# 确保 Docker 已运行 (需要 Docker 时使用)
ensure_docker_running() {
    if docker info &> /dev/null; then
        return
    fi

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
}

# 启动中间件 (Docker)
start_middleware() {
    echo -e "${YELLOW}[2/7] 启动中间件服务 (Docker)...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ "$START_MIDDLEWARE" != true ]; then
        echo -e "${YELLOW}⚠️  默认不启动中间件 (如需请添加 --with-middleware)${NC}"
        return
    fi

    if [ "$SKIP_ELASTICSEARCH" = true ]; then
        echo -e "${YELLOW}⚠️  已跳过 Elasticsearch (使用 --skip-elasticsearch)${NC}"
    fi

    if [ -f "docker-compose.yml" ]; then
        ensure_docker_running
        
        # 检查并清理异常退出的容器（防止端口残留）
        EXITED_CONTAINERS=$(docker_compose ps -a --filter "status=exited" -q 2>/dev/null || true)
        if [ -n "$EXITED_CONTAINERS" ]; then
            echo -e "${BLUE}   清理异常退出的容器...${NC}"
            docker_compose rm -f $EXITED_CONTAINERS 2>/dev/null || true
        fi
        
        # 启动容器
        load_middleware_services || true
        local compose_args=()
        if [ "$DOCKER_REMOVE_ORPHANS" = true ]; then
            compose_args+=(--remove-orphans)
        fi
        if [ ${#MIDDLEWARE_SERVICES[@]} -gt 0 ]; then
            compose_args+=("${MIDDLEWARE_SERVICES[@]}")
        fi

        if ! docker_compose up -d "${compose_args[@]}"; then
            echo -e "${RED}❌ 中间件启动失败${NC}"
            record_failure "中间件"
            return
        fi
        
        # 等待服务就绪
        echo -e "${BLUE}   等待中间件服务就绪...${NC}"
        if ! wait_for_middleware "$MIDDLEWARE_RETRIES" "$MIDDLEWARE_RETRY_DELAY"; then
            record_failure "中间件"
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
                if PID=$(read_pid "$PID_DIR/backend.pid"); then
                    if ps -p "$PID" > /dev/null 2>&1; then
                        echo -e "${YELLOW}⚠️  后端已在运行 (PID: $PID)${NC}"
                        return
                    fi
                else
                    rm -f "$PID_DIR/backend.pid"
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
                # 加载 .env 环境变量
                if [ -f "$PROJECT_ROOT/.env" ]; then
                    set -a
                    source "$PROJECT_ROOT/.env"
                    set +a
                fi
                nohup java -Dapp.log.path="$LOG_DIR" -DAPP_LOG_PATH="$LOG_DIR" -Dlogging.file.path="$LOG_DIR" -jar "$JAR_FILE" > "$LOG_DIR/backend.log" 2>&1 &
                local backend_pid=$!
                echo $backend_pid > "$PID_DIR/backend.pid"

                if ! wait_for_process "$backend_pid" "后端服务" "$LOG_DIR/backend.log"; then
                    record_failure "后端服务"
                    return
                fi

                if ! wait_for_http "http://localhost:8080/api/actuator/health" "后端服务" "$LOG_DIR/backend.log"; then
                    record_failure "后端服务"
                    return
                fi

                echo -e "${GREEN}✅ 后端服务已启动 (PID: $backend_pid)${NC}"
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
            if PID=$(read_pid "$PID_DIR/ai-service.pid"); then
                if ps -p "$PID" > /dev/null 2>&1; then
                    echo -e "${YELLOW}⚠️  AI 服务已在运行 (PID: $PID)${NC}"
                    return
                fi
            else
                rm -f "$PID_DIR/ai-service.pid"
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

        local should_install_ai_deps=false
        if [ ! -x ".venv/bin/uvicorn" ]; then
            should_install_ai_deps=true
        elif ! .venv/bin/python -c "import eval_type_backport" > /dev/null 2>&1; then
            echo -e "${BLUE}   检测到 AI 服务依赖不完整，正在补齐...${NC}"
            should_install_ai_deps=true
        fi

        if [ "$should_install_ai_deps" = true ]; then
            echo -e "${BLUE}   安装 AI 服务依赖...${NC}"
            .venv/bin/pip install -r requirements.txt
        fi

        nohup .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > "$LOG_DIR/ai-service.log" 2>&1 &
        local ai_pid=$!
        echo $ai_pid > "$PID_DIR/ai-service.pid"
        sleep 1

        if ! wait_for_process "$ai_pid" "AI 服务" "$LOG_DIR/ai-service.log"; then
            record_failure "AI 服务"
            return
        fi

        if ! wait_for_http "http://localhost:8000/health" "AI 服务" "$LOG_DIR/ai-service.log"; then
            record_failure "AI 服务"
            return
        fi

        echo -e "${GREEN}✅ AI 服务已启动 (PID: $ai_pid)${NC}"
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
            if PID=$(read_pid "$PID_DIR/blog.pid"); then
                if ps -p "$PID" > /dev/null 2>&1; then
                    echo -e "${YELLOW}⚠️  博客前台已在运行 (PID: $PID)${NC}"
                    return
                fi
            else
                rm -f "$PID_DIR/blog.pid"
            fi
        fi
        
        # 安装依赖并启动
        pnpm install --silent
        nohup pnpm dev > "$LOG_DIR/blog.log" 2>&1 &
        local blog_pid=$!
        echo $blog_pid > "$PID_DIR/blog.pid"

        if ! wait_for_process "$blog_pid" "博客前台" "$LOG_DIR/blog.log"; then
            record_failure "博客前台"
            return
        fi

        if ! wait_for_http "http://localhost:3000" "博客前台" "$LOG_DIR/blog.log"; then
            record_failure "博客前台"
            return
        fi

        echo -e "${GREEN}✅ 博客前台已启动 (PID: $blog_pid) - http://localhost:3000${NC}"
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
            if PID=$(read_pid "$PID_DIR/admin.pid"); then
                if ps -p "$PID" > /dev/null 2>&1; then
                    echo -e "${YELLOW}⚠️  管理后台已在运行 (PID: $PID)${NC}"
                    return
                fi
            else
                rm -f "$PID_DIR/admin.pid"
            fi
        fi
        
        # 安装依赖并启动
        pnpm install --silent
        nohup pnpm dev > "$LOG_DIR/admin.log" 2>&1 &
        local admin_pid=$!
        echo $admin_pid > "$PID_DIR/admin.pid"

        if ! wait_for_process "$admin_pid" "管理后台" "$LOG_DIR/admin.log"; then
            record_failure "管理后台"
            return
        fi

        if ! wait_for_http "http://localhost:5173" "管理后台" "$LOG_DIR/admin.log"; then
            record_failure "管理后台"
            return
        fi

        echo -e "${GREEN}✅ 管理后台已启动 (PID: $admin_pid) - http://localhost:5173${NC}"
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

    ensure_docker_running
    
    # 停止已有网关容器
    docker stop aetherblog-gateway 2>/dev/null || true
    docker rm aetherblog-gateway 2>/dev/null || true
    
    # 启动网关容器
    if [ "$PROD_MODE" = true ]; then
        # 生产模式: 优先使用 docker-compose.prod.yml 的 gateway 服务
        if ! docker_compose -f docker-compose.prod.yml up -d gateway 2>/dev/null; then
            if ! docker run -d --name aetherblog-gateway \
                -p 7899:80 \
                -v "$PROJECT_ROOT/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
                --network host \
                nginx:alpine 2>/dev/null; then
                echo -e "${RED}❌ 网关启动失败${NC}"
                record_failure "网关"
                return
            fi
        fi
    else
        # 开发网关模式: 使用开发配置
        if ! docker run -d --name aetherblog-gateway \
            -p 7899:80 \
            -v "$PROJECT_ROOT/nginx/${config_file}:/etc/nginx/conf.d/default.conf:ro" \
            --add-host=host.docker.internal:host-gateway \
            nginx:alpine; then
            echo -e "${RED}❌ 网关启动失败${NC}"
            record_failure "网关"
            return
        fi
    fi

    if ! wait_for_http "http://localhost:7899/health" "网关" ""; then
        record_failure "网关"
        return
    fi

    echo -e "${GREEN}✅ 网关已启动 (端口: 7899, 配置: ${config_file})${NC}"
}

# 显示状态
show_status() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
        echo -e "${RED}⚠️  AetherBlog 启动结束 (存在异常)${NC}"
    else
        echo -e "${GREEN}🎉 AetherBlog 启动完成!${NC}"
    fi
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
    echo -e "  📄 启动日志: $LOG_FILE"
    echo -e "  🛑 停止命令: ./stop.sh"
    echo ""

    if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
        echo -e "${RED}⚠️  启动存在异常服务: ${FAILED_SERVICES[*]}${NC}"
        echo -e "${RED}   请检查日志: $LOG_DIR${NC}"
    else
        echo -e "${GREEN}✅ 所有服务健康${NC}"
    fi
}

# 主流程
main() {
    acquire_lock
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

    if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
        exit 1
    fi
}

main
