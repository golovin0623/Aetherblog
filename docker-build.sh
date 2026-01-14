#!/bin/bash

# =============================================================================
# AetherBlog Docker Build & Push Script (Optimized for Multi-Core CPU)
# =============================================================================
# 
# 用法:
#   ./docker-build.sh                    # 构建所有镜像 (并行, 仅 amd64)
#   ./docker-build.sh --push             # 构建并推送到 Docker Hub
#   ./docker-build.sh --version v1.0.0   # 使用指定版本标签
#   ./docker-build.sh --full             # 构建多平台 (amd64 + arm64)
#   ./docker-build.sh --parallel         # 并行构建所有镜像 (默认)
#   ./docker-build.sh --sequential       # 串行构建 (网络不稳定时使用)
#   ./docker-build.sh --only backend     # 只构建后端
#   ./docker-build.sh --only blog        # 只构建博客前端
#   ./docker-build.sh --only admin       # 只构建管理后台
#
# 目标平台:
#   - linux/amd64 (默认, CentOS 7, 常规服务器)
#   - linux/arm64 (--full 启用, Mac M1/M2, ARM 服务器)
#
# 性能优化:
#   - 默认仅构建 amd64 平台，构建时间减少 ~50%
#   - 自动检测 CPU 核心数，并行构建充分利用多核
#   - 使用 BuildKit 缓存加速重复构建
#   - 支持并行构建多个镜像
#
# =============================================================================

set -e

# 配置
REGISTRY="${DOCKER_REGISTRY:-golovin0623}"
PROJECT="aetherblog"
VERSION="${VERSION:-v1.0.0}"
# 默认只构建 linux/amd64，使用 --full 启用多平台
PLATFORMS="linux/amd64"
FULL_BUILD=false
NATIVE_BUILD=false
PUSH=false
PARALLEL=true
ONLY=""

# 自动检测 CPU 核心数 (macOS 和 Linux 兼容)
CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
# BuildKit 并行度设置 (使用 CPU 核心数)
BUILDKIT_PARALLELISM="${BUILDKIT_PARALLELISM:-$CPU_CORES}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --push)
            PUSH=true
            shift
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --full)
            FULL_BUILD=true
            PLATFORMS="linux/amd64,linux/arm64"
            shift
            ;;
        --parallel)
            PARALLEL=true
            shift
            ;;
        --sequential)
            PARALLEL=false
            shift
            ;;
        --only)
            ONLY="$2"
            shift 2
            ;;
        --cores)
            BUILDKIT_PARALLELISM="$2"
            shift 2
            ;;
        --native)
            NATIVE_BUILD=true
            # Native Image 目前仅支持单平台构建
            PLATFORMS="linux/amd64"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --push              推送镜像到 Docker Hub"
            echo "  --version VERSION   指定版本标签 (默认: v1.0.0)"
            echo "  --full              构建多平台 (amd64 + arm64，默认仅 amd64)"
            echo "  --parallel          并行构建所有镜像 (默认)"
            echo "  --sequential        串行构建 (网络不稳定时使用)"
            echo "  --only NAME         只构建指定镜像 (backend/blog/admin)"
            echo "  --cores N           指定构建并行度 (默认: CPU核心数)"
            echo "  --native            使用 GraalVM Native Image 构建后端 (实验性)"
            echo "  -h, --help          显示帮助信息"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

print_header() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     AetherBlog Docker Multi-Platform Build (Optimized)     ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}Registry:${NC}     $REGISTRY"
    echo -e "${GREEN}Version:${NC}      $VERSION"
    echo -e "${GREEN}Platforms:${NC}    $PLATFORMS"
    echo -e "${GREEN}Full Build:${NC}   $FULL_BUILD"
    echo -e "${GREEN}Native:${NC}       $NATIVE_BUILD"
    echo -e "${GREEN}Push:${NC}         $PUSH"
    echo -e "${GREEN}Parallel:${NC}     $PARALLEL"
    echo -e "${CYAN}CPU Cores:${NC}    $CPU_CORES"
    echo -e "${CYAN}Parallelism:${NC}  $BUILDKIT_PARALLELISM"
    if [ -n "$ONLY" ]; then
        echo -e "${GREEN}Only:${NC}         $ONLY"
    fi
    echo ""
}

# 检查 Docker Buildx
check_buildx() {
    echo -e "${YELLOW}[1/5] 检查 Docker Buildx...${NC}"
    
    if ! docker buildx version > /dev/null 2>&1; then
        echo -e "${RED}Error: Docker Buildx is not available${NC}"
        echo "Please install Docker Buildx: https://docs.docker.com/buildx/working-with-buildx/"
        exit 1
    fi
    
    # 创建或使用 builder 实例 (配置最优参数)
    BUILDER_NAME="aetherblog-builder"
    if ! docker buildx inspect "$BUILDER_NAME" > /dev/null 2>&1; then
        echo -e "Creating optimized builder instance: $BUILDER_NAME"
        docker buildx create \
            --name "$BUILDER_NAME" \
            --driver docker-container \
            --driver-opt "network=host" \
            --buildkitd-flags "--allow-insecure-entitlement network.host" \
            --use \
            --bootstrap
    else
        docker buildx use "$BUILDER_NAME"
    fi
    
    echo -e "${GREEN}✓ Docker Buildx ready (using $BUILDKIT_PARALLELISM parallel jobs)${NC}"
}

# 登录 Docker Hub
docker_login() {
    if [ "$PUSH" = true ]; then
        echo -e "${YELLOW}[2/5] 检查 Docker Hub 登录状态...${NC}"
        
        if ! docker info 2>/dev/null | grep -q "Username"; then
            echo -e "${YELLOW}Please login to Docker Hub:${NC}"
            docker login
        fi
        
        echo -e "${GREEN}✓ Docker Hub login verified${NC}"
    else
        echo -e "${YELLOW}[2/5] 跳过 Docker Hub 登录 (非推送模式)${NC}"
    fi
}

# 构建单个镜像的通用函数
build_image() {
    local name=$1
    local dockerfile=$2
    local extra_args=$3
    local step=$4
    local log_file="/tmp/aetherblog-build-${name}.log"
    
    echo -e "${YELLOW}[${step}] 构建: ${REGISTRY}/${PROJECT}-${name}:${VERSION}${NC}"
    
    # 确定构建平台
    local build_platforms="$PLATFORMS"
    local load_flag=""
    
    if [ "$PUSH" = true ]; then
        load_flag="--push"
    else
        # 本地构建时只构建当前架构
        build_platforms="linux/$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')"
        load_flag="--load"
    fi
    
    # 构建命令
    BUILD_CMD="docker buildx build \
        --platform $build_platforms \
        -f ${dockerfile} \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        --cache-from type=registry,ref=${REGISTRY}/${PROJECT}-${name}:cache \
        -t ${REGISTRY}/${PROJECT}-${name}:${VERSION} \
        -t ${REGISTRY}/${PROJECT}-${name}:latest \
        --progress=auto \
        $load_flag \
        ${extra_args}"
    
    BUILD_CMD="$BUILD_CMD ."
    
    if eval "$BUILD_CMD" 2>&1 | tee "$log_file"; then
        echo -e "${GREEN}✓ ${name} image built${NC}"
        return 0
    else
        echo -e "${RED}✗ ${name} image build failed${NC}"
        return 1
    fi
}

# 并行构建所有镜像 (优化版 - 实时显示完成状态)
build_parallel() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}                   并行构建模式 (${CPU_CORES} 核心)                   ${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    local pids=()
    local names=("backend" "blog" "admin")
    local status_files=()
    local completed=0
    local failed=0
    
    # 创建状态文件
    for name in "${names[@]}"; do
        status_files+=("/tmp/aetherblog-status-${name}")
        rm -f "/tmp/aetherblog-status-${name}"
    done
    
    # 启动后端构建 (后台)
    (
        local backend_dockerfile="apps/server/Dockerfile"
        if [ "$NATIVE_BUILD" = true ]; then
            echo -e "${YELLOW}🚀 使用 GraalVM Native Image 构建后端...${NC}"
            backend_dockerfile="apps/server/Dockerfile.native"
        fi
        if build_image "backend" "$backend_dockerfile" "" "3/5"; then
            echo "success" > /tmp/aetherblog-status-backend
        else
            echo "failed" > /tmp/aetherblog-status-backend
        fi
    ) &
    pids+=($!)
    
    # 启动博客前端构建 (后台)
    (
        if build_image "blog" "apps/blog/Dockerfile" "--build-arg NEXT_PUBLIC_API_URL=http://backend:8080 --build-arg NEXT_PUBLIC_ADMIN_URL=\${ADMIN_URL:-/admin/}" "4/5"; then
            echo "success" > /tmp/aetherblog-status-blog
        else
            echo "failed" > /tmp/aetherblog-status-blog
        fi
    ) &
    pids+=($!)
    
    # 启动管理后台构建 (后台)
    (
        if build_image "admin" "apps/admin/Dockerfile" "" "5/5"; then
            echo "success" > /tmp/aetherblog-status-admin
        else
            echo "failed" > /tmp/aetherblog-status-admin
        fi
    ) &
    pids+=($!)
    
    echo -e "${CYAN}正在并行构建 ${#pids[@]} 个镜像...${NC}"
    echo ""
    
    # 实时监控完成状态
    local all_done=false
    local checked=("" "" "")
    
    while [ "$all_done" = false ]; do
        all_done=true
        for i in "${!names[@]}"; do
            if [ -z "${checked[$i]}" ]; then
                if [ -f "${status_files[$i]}" ]; then
                    local status=$(cat "${status_files[$i]}")
                    checked[$i]="$status"
                    ((completed++))
                    
                    if [ "$status" = "success" ]; then
                        echo -e "${GREEN}🎉 ${names[$i]} 构建完成并已推送!${NC} (${completed}/${#names[@]})"
                        if [ "$PUSH" = true ]; then
                            echo -e "   ${YELLOW}可以先在服务器拉取: docker pull ${REGISTRY}/${PROJECT}-${names[$i]}:${VERSION}${NC}"
                        fi
                    else
                        echo -e "${RED}✗ ${names[$i]} 构建失败${NC}"
                        ((failed++))
                    fi
                else
                    all_done=false
                fi
            fi
        done
        
        if [ "$all_done" = false ]; then
            sleep 2
        fi
    done
    
    echo ""
    echo -e "${CYAN}构建结果:${NC}"
    for i in "${!names[@]}"; do
        if [ "${checked[$i]}" = "success" ]; then
            echo -e "  ${GREEN}✓ ${names[$i]}${NC}"
        else
            echo -e "  ${RED}✗ ${names[$i]}${NC}"
        fi
    done
    
    # 清理状态文件
    rm -f /tmp/aetherblog-status-*
    
    if [ $failed -gt 0 ]; then
        echo -e "${RED}${failed} 个镜像构建失败${NC}"
        return 1
    fi
    
    return 0
}

# 串行构建所有镜像
build_sequential() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}                   串行构建模式                              ${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # 构建后端
    local backend_dockerfile="apps/server/Dockerfile"
    if [ "$NATIVE_BUILD" = true ]; then
        echo -e "${YELLOW}🚀 使用 GraalVM Native Image 构建后端...${NC}"
        backend_dockerfile="apps/server/Dockerfile.native"
    fi
    build_image "backend" "$backend_dockerfile" "" "3/5"
    build_image "blog" "apps/blog/Dockerfile" "--build-arg NEXT_PUBLIC_API_URL=http://backend:8080 --build-arg NEXT_PUBLIC_ADMIN_URL=\${ADMIN_URL:-/admin/}" "4/5"
    build_image "admin" "apps/admin/Dockerfile" "" "5/5"
}

# 只构建单个镜像
build_single() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}                   单独构建: $ONLY                          ${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    case "$ONLY" in
        backend)
            if [ "$NATIVE_BUILD" = true ]; then
                echo -e "${YELLOW}🚀 使用 GraalVM Native Image 构建...${NC}"
                build_image "backend" "apps/server/Dockerfile.native" "" "1/1"
            else
                build_image "backend" "apps/server/Dockerfile" "" "1/1"
            fi
            ;;
        blog)
            build_image "blog" "apps/blog/Dockerfile" "--build-arg NEXT_PUBLIC_API_URL=http://backend:8080 --build-arg NEXT_PUBLIC_ADMIN_URL=\${ADMIN_URL:-/admin/}" "1/1"
            ;;
        admin)
            build_image "admin" "apps/admin/Dockerfile" "" "1/1"
            ;;
        *)
            echo -e "${RED}Unknown image: $ONLY${NC}"
            echo "Available: backend, blog, admin"
            exit 1
            ;;
    esac
}

# 打印结果
print_summary() {
    local end_time=$(date +%s)
    local duration=$((end_time - START_TIME))
    
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                    构建完成!                                ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}耗时:${NC} ${duration} 秒"
    echo ""
    echo -e "${GREEN}镜像列表:${NC}"
    if [ -z "$ONLY" ] || [ "$ONLY" = "backend" ]; then
        echo "  - ${REGISTRY}/${PROJECT}-backend:${VERSION}"
    fi
    if [ -z "$ONLY" ] || [ "$ONLY" = "blog" ]; then
        echo "  - ${REGISTRY}/${PROJECT}-blog:${VERSION}"
    fi
    if [ -z "$ONLY" ] || [ "$ONLY" = "admin" ]; then
        echo "  - ${REGISTRY}/${PROJECT}-admin:${VERSION}"
    fi
    echo ""
    
    if [ "$PUSH" = true ]; then
        echo -e "${GREEN}镜像已推送到 Docker Hub!${NC}"
        echo ""
        echo -e "${YELLOW}服务器部署命令:${NC}"
        echo "  export DOCKER_REGISTRY=${REGISTRY}"
        echo "  export VERSION=${VERSION}"
        echo "  docker-compose -f docker-compose.prod.yml pull"
        echo "  docker-compose -f docker-compose.prod.yml up -d"
    else
        echo -e "${YELLOW}本地测试命令:${NC}"
        echo "  docker-compose -f docker-compose.prod.yml up -d"
        echo ""
        echo -e "${YELLOW}推送到 Docker Hub:${NC}"
        echo "  ./docker-build.sh --push --version ${VERSION}"
    fi
}

# 主流程
main() {
    START_TIME=$(date +%s)
    
    print_header
    check_buildx
    docker_login
    
    if [ -n "$ONLY" ]; then
        build_single
    elif [ "$PARALLEL" = true ]; then
        build_parallel
    else
        build_sequential
    fi
    
    print_summary
}

main
