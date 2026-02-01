# Docker Hub 镜像清理和重新发布指南

## 方案 1: 使用脚本自动删除 (推荐)

```bash
# 运行清理脚本
./docker-hub-cleanup.sh
```

脚本会:
1. 提示输入 Docker Hub 凭证
2. 列出所有要删除的镜像
3. 确认后批量删除所有标签

---

## 方案 2: 手动在 Docker Hub 网页删除

### 步骤:

1. **登录 Docker Hub**
   - 访问: https://hub.docker.com/
   - 使用你的账号登录

2. **删除 backend 镜像**
   - 进入: https://hub.docker.com/r/golovin0623/aetherblog-backend/tags
   - 选择所有标签 (latest, main-xxx, v*.*.* 等)
   - 点击 "Delete" 批量删除

3. **删除 blog 镜像**
   - 进入: https://hub.docker.com/r/golovin0623/aetherblog-blog/tags
   - 选择所有标签
   - 点击 "Delete" 批量删除

4. **删除 admin 镜像**
   - 进入: https://hub.docker.com/r/golovin0623/aetherblog-admin/tags
   - 选择所有标签
   - 点击 "Delete" 批量删除

---

## 方案 3: 使用 Docker Hub CLI (需要安装)

```bash
# 安装 hub-tool
brew install docker/hub-tool/hub-tool

# 登录
hub-tool login

# 删除所有标签
for repo in backend blog admin; do
    hub-tool tag ls golovin0623/aetherblog-${repo} | \
    awk '{print $2}' | \
    xargs -I {} hub-tool tag rm golovin0623/aetherblog-${repo}:{}
done
```

---

## 重新发布 v0.1.0 版本

### 步骤 1: 确保代码已提交

```bash
# 查看当前状态
git status

# 如果有未提交的更改,先提交
git add .
git commit -m "chore: prepare for v0.1.0 release"
```

### 步骤 2: 创建版本标签

```bash
# 创建 v0.1.0 标签
git tag -a v0.1.0 -m "Release version 0.1.0

初始发布版本:
- 完整的博客系统功能
- AI 辅助写作
- 媒体管理
- 评论系统
- 移动端适配
"

# 查看标签
git tag -l
```

### 步骤 3: 推送标签到 GitHub

```bash
# 推送标签
git push origin v0.1.0

# 或推送所有标签
git push origin --tags
```

### 步骤 4: 等待 GitHub Actions 自动构建

1. 访问: https://github.com/golovin0623/AetherBlog/actions
2. 查看 "Build and Push Docker Images" 工作流
3. 等待构建完成 (约 5-10 分钟)

### 步骤 5: 验证新镜像

```bash
# 检查 Docker Hub 是否有新镜像
docker pull golovin0623/aetherblog-backend:v0.1.0
docker pull golovin0623/aetherblog-backend:latest

docker pull golovin0623/aetherblog-blog:v0.1.0
docker pull golovin0623/aetherblog-blog:latest

docker pull golovin0623/aetherblog-admin:v0.1.0
docker pull golovin0623/aetherblog-admin:latest
```

---

## 预期结果

构建完成后,Docker Hub 上将只有以下镜像:

```
golovin0623/aetherblog-backend:v0.1.0
golovin0623/aetherblog-backend:latest

golovin0623/aetherblog-blog:v0.1.0
golovin0623/aetherblog-blog:latest

golovin0623/aetherblog-admin:v0.1.0
golovin0623/aetherblog-admin:latest
```

---

## 故障排查

### 问题 1: GitHub Actions 构建失败

**检查:**
- GitHub Secrets 是否配置正确 (DOCKER_USERNAME, DOCKER_PASSWORD)
- Docker Hub Token 是否有效
- 查看 Actions 日志获取详细错误信息

**解决:**
```bash
# 重新配置 Secrets
./.github/setup-secrets.sh
```

### 问题 2: 镜像推送失败

**可能原因:**
- Docker Hub Token 过期
- 网络问题
- 仓库权限问题

**解决:**
1. 重新生成 Docker Hub Token
2. 更新 GitHub Secrets
3. 手动触发工作流重试

### 问题 3: 标签已存在

**解决:**
```bash
# 删除本地标签
git tag -d v0.1.0

# 删除远程标签
git push origin :refs/tags/v0.1.0

# 重新创建标签
git tag -a v0.1.0 -m "Release version 0.1.0"
git push origin v0.1.0
```

---

## 快速命令参考

```bash
# 完整流程 (删除旧镜像后)
git tag -a v0.1.0 -m "Release version 0.1.0"
git push origin v0.1.0

# 查看构建状态
gh run list

# 查看最新运行的详细信息
gh run view --log

# 验证镜像
docker pull golovin0623/aetherblog-backend:v0.1.0
docker images | grep aetherblog
```
