#!/bin/bash

# GitHub Actions Secrets 配置助手
# 使用 GitHub CLI (gh) 快速设置所需的 Secrets

set -e

echo "🔧 GitHub Actions Secrets 配置助手"
echo "===================================="
echo ""

# 检查 gh CLI 是否安装
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) 未安装"
    echo ""
    echo "请先安装 GitHub CLI:"
    echo "  macOS:   brew install gh"
    echo "  Linux:   https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
    echo "  Windows: https://github.com/cli/cli/releases"
    exit 1
fi

# 检查是否已登录
if ! gh auth status &> /dev/null; then
    echo "⚠️  未登录 GitHub CLI"
    echo "请先运行: gh auth login"
    exit 1
fi

echo "✅ GitHub CLI 已就绪"
echo ""

# 获取当前仓库信息
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
if [ -z "$REPO" ]; then
    echo "❌ 无法获取仓库信息,请确保在 Git 仓库目录中运行此脚本"
    exit 1
fi

echo "📦 当前仓库: $REPO"
echo ""

# 配置 Docker Hub 凭证
echo "🐳 配置 Docker Hub 凭证"
echo "----------------------"
read -p "Docker Hub 用户名: " DOCKER_USERNAME
read -sp "Docker Hub Token (或密码): " DOCKER_PASSWORD
echo ""

if [ -n "$DOCKER_USERNAME" ] && [ -n "$DOCKER_PASSWORD" ]; then
    gh secret set DOCKER_USERNAME --body "$DOCKER_USERNAME"
    gh secret set DOCKER_PASSWORD --body "$DOCKER_PASSWORD"
    echo "✅ Docker Hub 凭证已设置"
else
    echo "⚠️  跳过 Docker Hub 凭证设置"
fi

echo ""

# 询问是否配置服务器部署
read -p "是否配置自动部署到服务器? (y/n): " SETUP_DEPLOY

if [ "$SETUP_DEPLOY" = "y" ] || [ "$SETUP_DEPLOY" = "Y" ]; then
    echo ""
    echo "🚀 配置服务器部署凭证"
    echo "--------------------"
    read -p "服务器 IP 或域名: " SERVER_HOST
    read -p "SSH 用户名: " SERVER_USER
    echo "SSH 私钥文件路径 (例如: ~/.ssh/id_rsa): "
    read -p "> " SSH_KEY_PATH

    # 展开 ~ 路径
    SSH_KEY_PATH="${SSH_KEY_PATH/#\~/$HOME}"

    if [ -f "$SSH_KEY_PATH" ]; then
        SSH_KEY=$(cat "$SSH_KEY_PATH")
        gh secret set SERVER_HOST --body "$SERVER_HOST"
        gh secret set SERVER_USER --body "$SERVER_USER"
        gh secret set SERVER_SSH_KEY --body "$SSH_KEY"
        echo "✅ 服务器部署凭证已设置"
    else
        echo "❌ SSH 私钥文件不存在: $SSH_KEY_PATH"
    fi
fi

echo ""
echo "🎉 配置完成!"
echo ""
echo "已设置的 Secrets:"
gh secret list

echo ""
echo "📝 后续步骤:"
echo "1. 推送代码到 main 分支触发自动构建"
echo "2. 或创建版本标签: git tag v1.0.0 && git push origin v1.0.0"
echo "3. 在 GitHub Actions 页面查看构建状态"
echo ""
echo "详细文档: .github/CICD_GUIDE.md"
