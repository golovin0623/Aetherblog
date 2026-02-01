# GitHub Actions 自动化部署配置指南

本项目使用 GitHub Actions 实现 CI/CD 自动化流程,包括测试、构建 Docker 镜像和自动部署。

## 📋 工作流说明

### 1. `docker-build-push.yml` - Docker 镜像构建和推送

**触发条件:**
- 推送到 `main` 分支
- 创建版本标签 (如 `v1.0.0`)
- 手动触发

**功能:**
- 并行构建 3 个服务的 Docker 镜像 (backend, blog, admin)
- 自动推送到 Docker Hub
- 支持多平台构建 (amd64, arm64)
- 使用 Docker 缓存加速构建

**版本策略:**
- Tag 触发: 使用 tag 名称 (如 `v1.0.0`)
- Main 分支: 使用 `main-{commit-sha}` + `latest`
- 手动触发: 使用自定义版本号

### 2. `ci-cd.yml` - 完整 CI/CD 流程

**触发条件:**
- 推送到 `main` 或 `develop` 分支
- 创建 Pull Request 到 `main`

**流程:**
1. **前端测试** - pnpm lint + build
2. **后端测试** - Maven test
3. **Docker 构建** - 仅在 main 分支推送时执行
4. **自动部署** - 通过 SSH 部署到服务器 (可选)

## 🔧 配置步骤

### 1. 设置 GitHub Secrets

在 GitHub 仓库中设置以下 Secrets (Settings → Secrets and variables → Actions):

#### 必需的 Secrets:

```bash
# Docker Hub 凭证
DOCKER_USERNAME=your_dockerhub_username
DOCKER_PASSWORD=your_dockerhub_password_or_token

# 服务器部署凭证 (如果启用自动部署)
SERVER_HOST=your.server.ip
SERVER_USER=your_ssh_username
SERVER_SSH_KEY=your_private_ssh_key
```

#### 获取 Docker Hub Token:

1. 登录 Docker Hub
2. 进入 Account Settings → Security
3. 点击 "New Access Token"
4. 复制生成的 token 作为 `DOCKER_PASSWORD`

### 2. 本地测试工作流

安装 [act](https://github.com/nektos/act) 在本地测试 GitHub Actions:

```bash
# macOS
brew install act

# 测试工作流
act -j build-and-push --secret-file .secrets
```

### 3. 创建版本发布

#### 方式 1: 使用 Git Tag

```bash
# 创建并推送 tag
git tag v1.0.0
git push origin v1.0.0

# 自动触发构建,镜像标签为 v1.0.0 和 latest
```

#### 方式 2: GitHub Release

1. 进入 GitHub 仓库页面
2. 点击 "Releases" → "Create a new release"
3. 填写 Tag version (如 `v1.0.0`)
4. 发布后自动触发构建

#### 方式 3: 手动触发

1. 进入 Actions 页面
2. 选择 "Build and Push Docker Images"
3. 点击 "Run workflow"
4. 输入自定义版本号

## 📦 Docker 镜像命名规则

构建后的镜像会推送到 Docker Hub,命名格式:

```
{DOCKER_USERNAME}/aetherblog-backend:v1.0.0
{DOCKER_USERNAME}/aetherblog-backend:latest
{DOCKER_USERNAME}/aetherblog-blog:v1.0.0
{DOCKER_USERNAME}/aetherblog-blog:latest
{DOCKER_USERNAME}/aetherblog-admin:v1.0.0
{DOCKER_USERNAME}/aetherblog-admin:latest
```

## 🚀 自动部署配置 (可选)

如果要启用自动部署到服务器,需要:

### 1. 生成 SSH 密钥对

```bash
# 在本地生成密钥对
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions

# 将公钥添加到服务器
ssh-copy-id -i ~/.ssh/github_actions.pub user@your.server.ip

# 将私钥内容复制到 GitHub Secrets (SERVER_SSH_KEY)
cat ~/.ssh/github_actions
```

### 2. 服务器准备

在服务器上准备部署目录:

```bash
# 创建部署目录
mkdir -p /opt/aetherblog
cd /opt/aetherblog

# 克隆仓库 (仅需要 docker-compose.prod.yml 和 .env)
git clone https://github.com/your-username/AetherBlog.git .

# 配置环境变量
cp .env.example .env
vim .env  # 编辑配置

# 确保 Docker 已安装
docker --version
docker-compose --version
```

### 3. 修改部署脚本

编辑 `.github/workflows/ci-cd.yml` 中的部署步骤:

```yaml
- name: Deploy to server via SSH
  uses: appleboy/ssh-action@v1.0.0
  with:
    host: ${{ secrets.SERVER_HOST }}
    username: ${{ secrets.SERVER_USER }}
    key: ${{ secrets.SERVER_SSH_KEY }}
    script: |
      cd /opt/aetherblog  # 修改为你的部署路径
      export DOCKER_REGISTRY=${{ env.DOCKER_REGISTRY }}
      export VERSION=latest
      docker-compose -f docker-compose.prod.yml pull
      docker-compose -f docker-compose.prod.yml up -d
      docker image prune -f
```

## 📊 监控构建状态

### 添加 Badge 到 README

在 `README.md` 中添加构建状态徽章:

```markdown
![CI/CD](https://github.com/your-username/AetherBlog/workflows/CI%2FCD%20Pipeline/badge.svg)
![Docker Build](https://github.com/your-username/AetherBlog/workflows/Build%20and%20Push%20Docker%20Images/badge.svg)
```

### 查看构建日志

1. 进入 GitHub 仓库的 "Actions" 页面
2. 点击具体的工作流运行记录
3. 查看每个步骤的详细日志

## 🔍 常见问题

### 1. Docker Hub 推送失败

**错误:** `denied: requested access to the resource is denied`

**解决:**
- 检查 `DOCKER_USERNAME` 和 `DOCKER_PASSWORD` 是否正确
- 确保使用的是 Access Token 而不是密码
- 检查 Docker Hub 仓库是否存在或有权限

### 2. 构建超时

**错误:** `The job running on runner ... has exceeded the maximum execution time`

**解决:**
- 启用 Docker 缓存 (已配置)
- 减少构建的平台数量 (移除 `linux/arm64`)
- 优化 Dockerfile 层级

### 3. SSH 部署失败

**错误:** `Permission denied (publickey)`

**解决:**
- 检查 SSH 密钥格式 (需要完整的私钥,包括 `-----BEGIN` 和 `-----END`)
- 确保服务器的 `~/.ssh/authorized_keys` 包含对应公钥
- 检查服务器 SSH 配置允许密钥登录

## 🎯 最佳实践

### 1. 版本管理

使用语义化版本号:
- `v1.0.0` - 主版本.次版本.修订号
- `v1.0.0-beta.1` - 预发布版本
- `v1.0.0-rc.1` - 候选发布版本

### 2. 分支策略

```
main (生产环境)
  ↑
develop (开发环境)
  ↑
feature/* (功能分支)
```

- `feature/*` → `develop`: 创建 PR,触发测试
- `develop` → `main`: 创建 PR,触发完整 CI/CD
- `main`: 自动构建和部署生产环境

### 3. 环境隔离

为不同环境创建不同的工作流:

```yaml
# .github/workflows/deploy-staging.yml
on:
  push:
    branches:
      - develop

# .github/workflows/deploy-production.yml
on:
  push:
    branches:
      - main
```

## 📝 示例工作流程

### 完整的发布流程:

```bash
# 1. 开发新功能
git checkout -b feature/new-feature
# ... 开发代码 ...
git commit -m "feat: add new feature"
git push origin feature/new-feature

# 2. 创建 PR 到 develop
# GitHub Actions 自动运行测试

# 3. 合并到 develop
# 触发开发环境部署 (如果配置)

# 4. 测试通过后,创建 PR 到 main
# GitHub Actions 再次运行测试

# 5. 合并到 main
# 自动构建 Docker 镜像并推送

# 6. 创建 Release
git tag v1.0.0
git push origin v1.0.0
# 自动构建带版本号的镜像

# 7. 自动部署到生产服务器 (如果配置)
```

## 🔗 相关资源

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
- [Docker Hub](https://hub.docker.com/)
- [SSH Action](https://github.com/appleboy/ssh-action)
