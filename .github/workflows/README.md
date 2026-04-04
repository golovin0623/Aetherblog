# GitHub Actions 工作流

本目录包含 AetherBlog 项目的自动化 CI/CD 工作流配置。

## 📁 工作流文件

### 1. `docker-build-push.yml` - 自动构建 Docker 镜像
**用途:** 当代码合并到 main 分支或创建版本标签时,自动构建并推送 Docker 镜像

**触发方式:**
```bash
# 方式 1: 推送到 main 分支
git push origin main

# 方式 2: 创建版本标签
git tag v1.0.0
git push origin v1.0.0

# 方式 3: 手动触发 (在 GitHub Actions 页面)
```

### 2. `ci-cd.yml` - 完整 CI/CD 流程
**用途:** 运行测试、构建、推送镜像和自动部署

**包含步骤:**
- ✅ 前端 Lint 和构建测试
- ✅ 后端 Go 测试
- 🐳 Docker 镜像构建和推送
- 🚀 自动部署到服务器 (可选)

### 3. `quick-build.yml` - 快速构建
**用途:** 手动触发快速构建单个或所有服务,跳过测试

**使用场景:**
- 紧急热修复
- 快速迭代测试
- 只需要重新构建某个服务

## 🚀 快速开始

### 第一步: 配置 GitHub Secrets

进入仓库 Settings → Secrets and variables → Actions,添加:

```
DOCKER_USERNAME=your_dockerhub_username
DOCKER_PASSWORD=your_dockerhub_token
```

### 第二步: 推送代码触发构建

```bash
# 开发完成后合并到 main
git checkout main
git merge feature/your-feature
git push origin main

# 自动触发构建,大约 5-10 分钟后镜像推送完成
```

### 第三步: 在服务器上拉取新镜像

```bash
# SSH 到服务器
ssh user@your-server

# 拉取最新镜像
cd /path/to/aetherblog
export DOCKER_REGISTRY=golovin0623
docker-compose -f docker-compose.prod.yml pull

# 重启服务
docker-compose -f docker-compose.prod.yml up -d
```

## 📋 常用操作

### 创建版本发布

```bash
# 1. 确保在 main 分支
git checkout main
git pull origin main

# 2. 创建版本标签
git tag -a v1.0.0 -m "Release version 1.0.0"

# 3. 推送标签
git push origin v1.0.0

# 4. 自动构建镜像:
#    - golovin0623/aetherblog-backend:v1.0.0
#    - golovin0623/aetherblog-blog:v1.0.0
#    - golovin0623/aetherblog-admin:v1.0.0
#    - 同时更新 latest 标签
```

### 手动触发构建

1. 进入 GitHub 仓库页面
2. 点击 "Actions" 标签
3. 选择工作流 (如 "Quick Docker Build")
4. 点击 "Run workflow"
5. 选择参数并运行

### 查看构建状态

```bash
# 在 GitHub Actions 页面查看实时日志
# 或使用 GitHub CLI
gh run list
gh run view <run-id> --log
```

## 🔧 高级配置

详细配置说明请查看: [CICD_GUIDE.md](./CICD_GUIDE.md)

包含:
- 自动部署配置
- SSH 密钥设置
- 多环境部署
- 故障排查

## 💡 提示

1. **首次使用前必须配置 Docker Hub 凭证**
2. **构建大约需要 5-10 分钟** (取决于网络和缓存)
3. **使用缓存可以加速后续构建** (已自动配置)
4. **建议使用版本标签管理发布** (v1.0.0, v1.1.0 等)

## 📊 构建状态

在 README.md 中添加徽章显示构建状态:

```markdown
![CI/CD](https://github.com/golovin0623/AetherBlog/workflows/CI%2FCD%20Pipeline/badge.svg)
```
