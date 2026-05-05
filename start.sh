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

# 读取 .env 中某个 KEY 的当前值（仅匹配行首 KEY=...，不展开变量）
get_env_field() {
    local key=$1
    grep -E "^${key}=" "$PROJECT_ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2-
}

# 跨平台 sed -i：GNU sed 用 "-i"，BSD/macOS sed 用 "-i ''"
sed_inplace() {
    if sed --version >/dev/null 2>&1; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

# 如果 .env 中 KEY 当前为空（或不存在），就把它就地设置为 VALUE。
# 已经有非空值时不会覆盖，保护用户手填的密钥。
bootstrap_secret_field() {
    local key=$1
    local value=$2
    local current
    current=$(get_env_field "$key")
    if [ -n "$current" ]; then
        return 0
    fi
    if grep -qE "^${key}=" "$PROJECT_ROOT/.env" 2>/dev/null; then
        # base64 不含 "|"，用作 sed 分隔符避免转义
        sed_inplace "s|^${key}=.*|${key}=${value}|" "$PROJECT_ROOT/.env"
    else
        echo "${key}=${value}" >> "$PROJECT_ROOT/.env"
    fi
    echo -e "${GREEN}   ✅ 已自动生成 ${key}${NC}"
}

# 生产模式下，若配置缺失或仍是已知开发默认值，则强制修复为安全值。
# 仅适用于「容器在每次启动时从 env 读取」的字段（如 REDIS_PASSWORD、AUTH_COOKIE_SECURE）。
# 对于「有持久化绑定」的字段（如 POSTGRES_PASSWORD 写入 PGDATA 后不再读 env），请用
# require_prod_secure_field 走「检测到默认值则报错引导手动轮换」的路径，避免静默改写后
# 与已初始化的数据卷分叉、把跑着的部署打挂。
bootstrap_prod_secure_field() {
    local key=$1
    local secure_value=$2
    shift 2
    local insecure_values=("$@")
    local current
    current=$(get_env_field "$key" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

    if [ -z "$current" ]; then
        bootstrap_secret_field "$key" "$secure_value"
        return 0
    fi

    local insecure
    for insecure in "${insecure_values[@]}"; do
        if [ "$current" = "$insecure" ]; then
            sed_inplace "s|^${key}=.*|${key}=${secure_value}|" "$PROJECT_ROOT/.env"
            echo -e "${GREEN}   ✅ 生产模式已修复 ${key}${NC}"
            return 0
        fi
    done
}

# 生产模式下，若关键字段缺失或仍是已知开发默认值，则报错并引导手动处理。
# 用于「有持久化绑定」的字段：例如 POSTGRES_PASSWORD 一旦 PGDATA 完成初始化就锁定在
# 容器内，再去 .env 里改密只会让 backend 拿新密码连库 28P01。这种字段不能由脚本静默替换。
require_prod_secure_field() {
    local key=$1
    local hint=$2
    shift 2
    local insecure_values=("$@")
    local current
    current=$(get_env_field "$key" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

    if [ -z "$current" ]; then
        echo -e "${RED}❌ FATAL: 生产模式下 ${key} 必须显式设置${NC}" >&2
        echo -e "${YELLOW}   ${hint}${NC}" >&2
        exit 1
    fi

    local insecure
    for insecure in "${insecure_values[@]}"; do
        if [ "$current" = "$insecure" ]; then
            echo -e "${RED}❌ FATAL: 生产模式下 ${key} 仍为已知开发默认值 (${insecure})${NC}" >&2
            echo -e "${YELLOW}   ${hint}${NC}" >&2
            exit 1
        fi
    done
}

# 自动 bootstrap 缺失的 env 文件（首次启动友好）
# 1) 根 .env 缺失 → 从 .env.example 拷贝
# 2) .env 中关键密钥字段为空 → 就地生成强密钥（JWT/内部令牌/Fernet）
# 3) apps/{blog,admin}/.env.local 缺失 → 从同目录 .env.local.example 拷贝
bootstrap_env() {
    echo -e "${YELLOW}[准备] 校准环境配置...${NC}"

    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        if [ ! -f "$PROJECT_ROOT/.env.example" ]; then
            echo -e "${RED}❌ 既无 .env 也无 .env.example，无法 bootstrap${NC}" >&2
            exit 1
        fi
        if [ "$PROD_MODE" = true ]; then
            echo -e "${RED}❌ 生产模式检测到缺失 .env。为避免使用示例弱口令，请先手动创建安全 .env 后重试。${NC}" >&2
            echo -e "${YELLOW}   提示：至少请设置 POSTGRES_PASSWORD、REDIS_PASSWORD、AUTH_COOKIE_SECURE=true。${NC}" >&2
            exit 1
        fi
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
        echo -e "${GREEN}   ✅ 已从 .env.example 创建 .env${NC}"
    fi

    # 数据库/缓存密码：仅在非生产模式下自动生成。
    # 生产模式由下方 require_prod_secure_field / bootstrap_prod_secure_field 接管，
    # 以避免把已初始化的 PGDATA 与 .env 静默分叉（详见下方 PROD_MODE 分支注释）。
    if [ "$PROD_MODE" = false ]; then
        bootstrap_secret_field "POSTGRES_PASSWORD" "$(openssl rand -base64 48 | tr -d '\n')"
        bootstrap_secret_field "REDIS_PASSWORD" "$(openssl rand -base64 48 | tr -d '\n')"
    fi

    # JWT 签名启动 seed
    bootstrap_secret_field "JWT_SECRET" "$(openssl rand -base64 48 | tr -d '\n')"

    # Go ↔ AI 内部服务令牌（两个变量必须取相同值）
    if [ -z "$(get_env_field AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN)" ] || [ -z "$(get_env_field AI_INTERNAL_SERVICE_TOKEN)" ]; then
        local _itoken
        _itoken=$(openssl rand -base64 48 | tr -d '\n')
        bootstrap_secret_field "AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN" "$_itoken"
        bootstrap_secret_field "AI_INTERNAL_SERVICE_TOKEN" "$_itoken"
    fi

    # AI Provider Key 加密用 Fernet 密钥（32B base64url + padding）
    if [ -z "$(get_env_field AI_CREDENTIAL_ENCRYPTION_KEYS)" ]; then
        local _fkey=""
        if command -v "$PYTHON_BIN" >/dev/null 2>&1; then
            _fkey=$("$PYTHON_BIN" -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || true)
        fi
        if [ -z "$_fkey" ]; then
            # Python cryptography 可能未装；回退到等价的 32B base64url + 单 = 填充
            _fkey="$(openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=\n')="
        fi
        bootstrap_secret_field "AI_CREDENTIAL_ENCRYPTION_KEYS" "$_fkey"
    fi

    if [ "$PROD_MODE" = true ]; then
        # POSTGRES_PASSWORD 不能由脚本静默轮换：PG 容器只在 PGDATA 首次初始化时
        # 写入这个口令，之后启动忽略 env。强行替换会让 backend 拿新口令连库直接
        # 28P01，已部署的实例会被这次「加固」打挂。改成检测到默认值即停机引导
        # 运维手动 ALTER ROLE。
        require_prod_secure_field "POSTGRES_PASSWORD" \
            "请在 .env 中将 POSTGRES_PASSWORD 设为强随机值 (e.g. openssl rand -base64 48)；如已用默认值初始化数据库，请同步执行 ALTER ROLE aetherblog WITH PASSWORD '...'; 然后再重启。" \
            "aetherblog123"

        # REDIS_PASSWORD 安全可旋转：Redis 容器在每次启动时从 --requirepass 读取
        # 当前 env 值，AOF/RDB 不持久化口令，所以静默生成强密钥不会与持久数据分叉。
        bootstrap_prod_secure_field "REDIS_PASSWORD" "$(openssl rand -base64 48 | tr -d '\n')" "aetherblog_dev"

        # 仅当网关前面有 HTTPS 终结时才正确——否则浏览器不回带 Cookie，登录会断。
        bootstrap_prod_secure_field "AUTH_COOKIE_SECURE" "true" "false"

        # 注：不在这里改写 REDIS_HOST。`./start.sh --prod` 把 backend / ai-service
        # 跑在宿主机进程里，宿主机 DNS 解析不到容器服务名 "redis"。要改成全容器化
        # 部署请走 `docker compose -f docker-compose.prod.yml up`，那条路径下
        # REDIS_HOST 由 compose 注入，而不是这个脚本。
    fi

    # 前端 .env.local
    local app
    for app in blog admin; do
        local target="$PROJECT_ROOT/apps/$app/.env.local"
        local template="$PROJECT_ROOT/apps/$app/.env.local.example"
        if [ ! -f "$target" ] && [ -f "$template" ]; then
            cp "$template" "$target"
            echo -e "${GREEN}   ✅ 已为 $app 创建 .env.local${NC}"
        fi
    done

    echo -e "${GREEN}✅ 环境配置就绪${NC}"
}

# 记录启动失败的服务
record_failure() {
    local name=$1
    FAILED_SERVICES+=("$name")
}

# 安全地读取 PID
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

# 等待中间件全部进入运行状态
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

# 启动后端 (Go 服务)
start_backend() {
    echo -e "${YELLOW}[4/7] 启动后端服务...${NC}"

    BACKEND_DIR="$PROJECT_ROOT/apps/server-go"

    if [ -d "$BACKEND_DIR/cmd/server" ]; then
        if command -v go &> /dev/null; then
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

            # 加载 .env 环境变量
            if [ -f "$PROJECT_ROOT/.env" ]; then
                set -a
                source "$PROJECT_ROOT/.env"
                set +a
            fi

            # SECURITY (VULN-121): JWT_SECRET 必须由运维显式提供。早期版本会
            # 在缺失时回落到固定 dev 字符串，导致开发与生产共用已知密钥。
            if [ -z "${JWT_SECRET:-}" ]; then
                echo -e "${RED}❌ FATAL: JWT_SECRET 未设置${NC}" >&2
                echo -e "${YELLOW}   1) 拷贝模板:  cp .env.example .env${NC}" >&2
                echo -e "${YELLOW}   2) 生成强密钥: openssl rand -base64 48${NC}" >&2
                echo -e "${YELLOW}   3) 写入 .env 中的 JWT_SECRET 字段${NC}" >&2
                record_failure "后端服务"
                return
            fi
            if [ "${#JWT_SECRET}" -lt 32 ]; then
                echo -e "${RED}❌ FATAL: JWT_SECRET 长度不足 32 字符 (实际 ${#JWT_SECRET})${NC}" >&2
                record_failure "后端服务"
                return
            fi

            # 确保提供内部服务令牌 (开发模式自动生成，与 AI 服务共享)
            if [ -z "${AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN:-}" ] && [ -z "${AI_INTERNAL_SERVICE_TOKEN:-}" ]; then
                local _token=$(openssl rand -base64 48)
                export AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN="$_token"
                export AI_INTERNAL_SERVICE_TOKEN="$_token"
            elif [ -n "${AI_INTERNAL_SERVICE_TOKEN:-}" ] && [ -z "${AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN:-}" ]; then
                export AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN="$AI_INTERNAL_SERVICE_TOKEN"
            fi

            # 编译并启动
            echo -e "${BLUE}   编译 Go 后端...${NC}"
            go build -o "$BACKEND_DIR/bin/server" ./cmd/server

            export AETHERBLOG_LOG_PATH="$LOG_DIR"

            echo -e "${BLUE}   启动后端服务...${NC}"
            nohup "$BACKEND_DIR/bin/server" > "$LOG_DIR/backend.log" 2>&1 &
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
            echo -e "${YELLOW}⚠️  Go 未安装，跳过后端启动${NC}"
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

        # 确保导出必要的环境变量
        if [ -f "$PROJECT_ROOT/.env" ]; then
            set -a
            source "$PROJECT_ROOT/.env"
            set +a
        fi
        
        # 构建 POSTGRES_DSN (如果未提供)
        if [ -z "${POSTGRES_DSN:-}" ]; then
            DB_USER=${POSTGRES_USER:-aetherblog}
            DB_PASS=${POSTGRES_PASSWORD:-aetherblog123}
            DB_HOST=${POSTGRES_HOST:-localhost}
            DB_PORT=${POSTGRES_PORT:-5432}
            DB_NAME=${POSTGRES_DB:-aetherblog}
            export POSTGRES_DSN="postgresql+asyncpg://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
        fi

        # SECURITY (VULN-121): 同后端，AI 服务也禁止回落到默认 JWT 密钥。
        if [ -z "${JWT_SECRET:-}" ]; then
            echo -e "${RED}❌ FATAL: JWT_SECRET 未设置 (AI 服务)${NC}" >&2
            echo -e "${YELLOW}   生成: openssl rand -base64 48${NC}" >&2
            record_failure "AI 服务"
            return
        fi
        if [ "${#JWT_SECRET}" -lt 32 ]; then
            echo -e "${RED}❌ FATAL: JWT_SECRET 长度不足 32 字符 (实际 ${#JWT_SECRET}, AI 服务)${NC}" >&2
            record_failure "AI 服务"
            return
        fi

        # SECURITY (VULN-056): credential 加密密钥必须独立于 JWT_SECRET。
        if [ -z "${AI_CREDENTIAL_ENCRYPTION_KEYS:-}" ]; then
            echo -e "${RED}❌ FATAL: AI_CREDENTIAL_ENCRYPTION_KEYS 未设置${NC}" >&2
            echo -e "${YELLOW}   生成: python3 -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"${NC}" >&2
            echo -e "${YELLOW}   写入 .env 后再启动；多 key 用逗号分隔以支持轮换${NC}" >&2
            record_failure "AI 服务"
            return
        fi

        export AI_LOG_PATH="$LOG_DIR"

        # 确保 AI 服务继承内部服务令牌（由 start_backend 或 .env 提供）
        if [ -n "${AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN:-}" ] && [ -z "${AI_INTERNAL_SERVICE_TOKEN:-}" ]; then
            export AI_INTERNAL_SERVICE_TOKEN="$AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN"
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
        
        # 加载根目录 .env (将 NEXT_PUBLIC_* 等变量注入到前端进程)
        if [ -f "$PROJECT_ROOT/.env" ]; then
            set -a
            source "$PROJECT_ROOT/.env"
            set +a
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
        
        # 加载根目录 .env (将 VITE_* 等变量注入到前端进程)
        if [ -f "$PROJECT_ROOT/.env" ]; then
            set -a
            source "$PROJECT_ROOT/.env"
            set +a
        fi

        # 安装依赖并启动
        pnpm install --silent
        nohup pnpm dev < /dev/null > "$LOG_DIR/admin.log" 2>&1 &
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
    bootstrap_env
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
