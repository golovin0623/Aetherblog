#!/bin/bash

# Docker Hub 镜像批量删除脚本
# 使用 Docker Hub API 删除所有镜像标签

set -e

# 配置
DOCKER_USERNAME="${DOCKER_USERNAME:-golovin0623}"
REPOSITORIES=("aetherblog-backend" "aetherblog-blog" "aetherblog-admin")

echo "🗑️  Docker Hub 镜像清理脚本"
echo "================================"
echo ""

# 检查是否已登录
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行,请先启动 Docker"
    exit 1
fi

echo "📋 将要删除以下仓库的所有镜像:"
for repo in "${REPOSITORIES[@]}"; do
    echo "  - ${DOCKER_USERNAME}/${repo}"
done
echo ""

read -p "⚠️  确认删除所有镜像? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
    echo "❌ 操作已取消"
    exit 0
fi

echo ""
echo "🔐 请输入 Docker Hub 凭证:"
read -p "用户名 [${DOCKER_USERNAME}]: " input_username
DOCKER_USERNAME="${input_username:-$DOCKER_USERNAME}"

read -sp "密码或 Token: " DOCKER_PASSWORD
echo ""
echo ""

# 获取 JWT Token
echo "🔑 正在获取认证 Token..."
TOKEN=$(curl -s -H "Content-Type: application/json" -X POST \
    -d "{\"username\": \"${DOCKER_USERNAME}\", \"password\": \"${DOCKER_PASSWORD}\"}" \
    https://hub.docker.com/v2/users/login/ | jq -r .token)

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    echo "❌ 认证失败,请检查用户名和密码"
    exit 1
fi

echo "✅ 认证成功"
echo ""

# 删除每个仓库的所有标签
for repo in "${REPOSITORIES[@]}"; do
    echo "📦 处理仓库: ${DOCKER_USERNAME}/${repo}"

    # 获取所有标签
    tags=$(curl -s -H "Authorization: JWT ${TOKEN}" \
        "https://hub.docker.com/v2/repositories/${DOCKER_USERNAME}/${repo}/tags/?page_size=100" \
        | jq -r '.results[].name')

    if [[ -z "$tags" ]]; then
        echo "  ℹ️  仓库为空或不存在"
        continue
    fi

    echo "  发现标签:"
    echo "$tags" | sed 's/^/    - /'
    echo ""

    # 删除每个标签
    for tag in $tags; do
        echo "  🗑️  删除标签: ${tag}"
        response=$(curl -s -X DELETE \
            -H "Authorization: JWT ${TOKEN}" \
            "https://hub.docker.com/v2/repositories/${DOCKER_USERNAME}/${repo}/tags/${tag}/")

        if [[ $? -eq 0 ]]; then
            echo "    ✅ 已删除"
        else
            echo "    ❌ 删除失败"
        fi
    done

    echo ""
done

echo "✅ 所有镜像已删除!"
echo ""
echo "📝 下一步:"
echo "  1. 创建版本标签: git tag v0.1.0"
echo "  2. 推送标签: git push origin v0.1.0"
echo "  3. GitHub Actions 将自动构建并推送新镜像"
