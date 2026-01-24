# GitHub Actions 自动化部署

本目录包含 AetherBlog 项目的 CI/CD 自动化配置。

## 📁 文件说明

```
.github/
├── workflows/
│   ├── docker-build-push.yml  # 自动构建 Docker 镜像 (main 分支触发)
│   ├── ci-cd.yml              # 完整 CI/CD 流程 (测试+构建+部署)
│   ├── quick-build.yml        # 快速构建 (手动触发)
│   └── README.md              # 工作流使用说明
├── CICD_GUIDE.md              # 详细配置指南 ⭐
├── QUICK_REFERENCE.txt        # 快速参考卡片
└── setup-secrets.sh           # Secrets 配置助手脚本
```

## 🚀 快速开始 (3 步)

### 1️⃣ 配置 Docker Hub 凭证

**方式 A: 使用脚本 (推荐)**
```bash
./.github/setup-secrets.sh
```

**方式 B: 使用 GitHub CLI**
```bash
gh secret set DOCKER_USERNAME
gh secret set DOCKER_PASSWORD
```

**方式 C: 在 GitHub 网页设置**
- 进入仓库 Settings → Secrets and variables → Actions
- 点击 "New repository secret"
- 添加 `DOCKER_USERNAME` 和 `DOCKER_PASSWORD`

### 2️⃣ 推送代码触发构建

```bash
# 合并到 main 分支
git checkout main
git merge your-feature-branch
git push origin main

# 或创建版本标签
git tag v1.0.0
git push origin v1.0.0
```

### 3️⃣ 等待构建完成

- 进入 GitHub Actions 页面查看进度
- 构建时间: 5-10 分钟 (首次), 2-5 分钟 (有缓存)
- 完成后镜像自动推送到 Docker Hub

## 📦 构建产物

成功后会生成以下 Docker 镜像:

```
golovin0623/aetherblog-backend:latest
golovin0623/aetherblog-backend:v1.0.0

golovin0623/aetherblog-blog:latest
golovin0623/aetherblog-blog:v1.0.0

golovin0623/aetherblog-admin:latest
golovin0623/aetherblog-admin:v1.0.0
```

## 🔄 工作流触发方式

| 工作流 | 触发方式 | 用途 |
|--------|---------|------|
| docker-build-push.yml | 推送到 main / 创建 tag / 手动 | 自动构建镜像 |
| ci-cd.yml | 推送到 main/develop / PR | 完整 CI/CD |
| quick-build.yml | 仅手动触发 | 快速构建单个服务 |

## 📚 详细文档

- **[CICD_GUIDE.md](./CICD_GUIDE.md)** - 完整配置指南,包含:
  - 自动部署配置
  - SSH 密钥设置
  - 多环境部署
  - 故障排查

- **[workflows/README.md](./workflows/README.md)** - 工作流使用说明

- **[QUICK_REFERENCE.txt](./QUICK_REFERENCE.txt)** - 快速参考卡片

## 💡 常见问题

### Q: 如何查看构建状态?
```bash
# 使用 GitHub CLI
gh run list
gh run watch

# 或访问 GitHub Actions 页面
```

### Q: 如何手动触发构建?
```bash
# 使用 GitHub CLI
gh workflow run "Quick Docker Build" -f service=all -f version=v1.0.0

# 或在 GitHub Actions 页面点击 "Run workflow"
```

### Q: 构建失败怎么办?
1. 查看 Actions 页面的详细日志
2. 检查 Docker Hub 凭证是否正确
3. 确保 Dockerfile 路径正确
4. 查看 [CICD_GUIDE.md](./CICD_GUIDE.md) 的故障排查章节

### Q: 如何部署到服务器?
```bash
# SSH 到服务器
ssh user@your-server

# 拉取最新镜像
cd /opt/aetherblog
export DOCKER_REGISTRY=golovin0623
docker-compose -f docker-compose.prod.yml pull

# 重启服务
docker-compose -f docker-compose.prod.yml up -d
```

## 🎯 最佳实践

1. **使用版本标签管理发布**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **在 PR 中查看测试结果**
   - 创建 PR 会自动运行测试
   - 确保测试通过后再合并

3. **使用缓存加速构建**
   - 已自动配置 Docker 层缓存
   - 后续构建会更快

4. **监控构建状态**
   - 在 README 中添加徽章
   - 使用 GitHub CLI 查看状态

## 📞 需要帮助?

- 查看详细文档: [CICD_GUIDE.md](./CICD_GUIDE.md)
- 查看快速参考: [QUICK_REFERENCE.txt](./QUICK_REFERENCE.txt)
- GitHub Actions 官方文档: https://docs.github.com/en/actions
