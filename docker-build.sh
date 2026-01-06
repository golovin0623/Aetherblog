#!/bin/bash

# =============================================================================
# AetherBlog Docker Build & Push Script
# =============================================================================
# 
# 用法:
#   ./docker-build.sh              # 构建所有镜像
#   ./docker-build.sh --push       # 构建并推送到 Docker Hub
#   ./docker-build.sh --version v1.0.0  # 使用指定版本标签
#
# 目标平台:
#   - linux/amd64 (CentOS 7, 常规服务器)
#   - linux/arm64 (Mac M1/M2, ARM 服务器)
#
# =============================================================================

set -e

# 配置
REGISTRY="golovin0623"
PROJECT="aetherblog"
VERSION="${VERSION:-v1.0.0}"
PLATFORMS="linux/amd64,linux/arm64"
PUSH=false

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          AetherBlog Docker Multi-Platform Build            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Registry:${NC}   $REGISTRY"
echo -e "${GREEN}Version:${NC}    $VERSION"
echo -e "${GREEN}Platforms:${NC}  $PLATFORMS"
echo -e "${GREEN}Push:${NC}       $PUSH"
echo ""

# 检查 Docker Buildx
check_buildx() {
    echo -e "${YELLOW}[1/5] 检查 Docker Buildx...${NC}"
    
    if ! docker buildx version > /dev/null 2>&1; then
        echo -e "${RED}Error: Docker Buildx is not available${NC}"
        echo "Please install Docker Buildx: https://docs.docker.com/buildx/working-with-buildx/"
        exit 1
    fi
    
    # 创建或使用 builder 实例
    BUILDER_NAME="aetherblog-builder"
    if ! docker buildx inspect "$BUILDER_NAME" > /dev/null 2>&1; then
        echo -e "Creating builder instance: $BUILDER_NAME"
        docker buildx create --name "$BUILDER_NAME" --use --bootstrap
    else
        docker buildx use "$BUILDER_NAME"
    fi
    
    echo -e "${GREEN}✓ Docker Buildx ready${NC}"
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

# 构建后端镜像
build_backend() {
    echo -e "${YELLOW}[3/5] 构建后端镜像: ${REGISTRY}/${PROJECT}-backend:${VERSION}${NC}"
    
    BUILD_CMD="docker buildx build \
        --platform $PLATFORMS \
        -f apps/server/Dockerfile \
        -t ${REGISTRY}/${PROJECT}-backend:${VERSION} \
        -t ${REGISTRY}/${PROJECT}-backend:latest"
    
    if [ "$PUSH" = true ]; then
        BUILD_CMD="$BUILD_CMD --push"
    else
        BUILD_CMD="$BUILD_CMD --load --platform linux/$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')"
    fi
    
    eval "$BUILD_CMD ."
    
    echo -e "${GREEN}✓ Backend image built${NC}"
}

# 构建博客前端镜像
build_blog() {
    echo -e "${YELLOW}[4/5] 构建博客前端镜像: ${REGISTRY}/${PROJECT}-blog:${VERSION}${NC}"
    
    BUILD_CMD="docker buildx build \
        --platform $PLATFORMS \
        -f apps/blog/Dockerfile \
        --build-arg NEXT_PUBLIC_API_URL=http://backend:8080 \
        -t ${REGISTRY}/${PROJECT}-blog:${VERSION} \
        -t ${REGISTRY}/${PROJECT}-blog:latest"
    
    if [ "$PUSH" = true ]; then
        BUILD_CMD="$BUILD_CMD --push"
    else
        BUILD_CMD="$BUILD_CMD --load --platform linux/$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')"
    fi
    
    eval "$BUILD_CMD ."
    
    echo -e "${GREEN}✓ Blog image built${NC}"
}

# 构建管理后台镜像
build_admin() {
    echo -e "${YELLOW}[5/5] 构建管理后台镜像: ${REGISTRY}/${PROJECT}-admin:${VERSION}${NC}"
    
    BUILD_CMD="docker buildx build \
        --platform $PLATFORMS \
        -f apps/admin/Dockerfile \
        -t ${REGISTRY}/${PROJECT}-admin:${VERSION} \
        -t ${REGISTRY}/${PROJECT}-admin:latest"
    
    if [ "$PUSH" = true ]; then
        BUILD_CMD="$BUILD_CMD --push"
    else
        BUILD_CMD="$BUILD_CMD --load --platform linux/$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')"
    fi
    
    eval "$BUILD_CMD ."
    
    echo -e "${GREEN}✓ Admin image built${NC}"
}

# 打印结果
print_summary() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                    构建完成!                                ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}镜像列表:${NC}"
    echo "  - ${REGISTRY}/${PROJECT}-backend:${VERSION}"
    echo "  - ${REGISTRY}/${PROJECT}-blog:${VERSION}"
    echo "  - ${REGISTRY}/${PROJECT}-admin:${VERSION}"
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
    check_buildx
    docker_login
    build_backend
    build_blog
    build_admin
    print_summary
}

main
