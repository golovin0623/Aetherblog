# 语法=Docker/Dockerfile:1

# =============================================================================
# AetherBlog 管理员 - Vite React 管理面板
# 多平台：linux/amd64 (CentOS 7)、linux/arm64 (Mac M1/M2)
# =============================================================================

# 第一阶段：构建
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 安装具有特定版本的 pnpm 以实现可重复性
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# 复制包文件
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/admin/package.json ./apps/admin/

# 使用缓存挂载安装依赖项
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 复制源文件
COPY apps/admin ./apps/admin

# 构建应用程序（使用相对 /API 路径，nginx 代理到后端）
ENV NODE_ENV=production
# 捆绑管理应用程序时，Vite 可能会超过 CI/buildx 中 Node 默认的约 2GB 堆。
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm --filter @aetherblog/admin build

# 第 2 阶段：使用 Nginx 进行生产（非特权）
# 安全（VULN-124）：使用 nginxinc/nginx-unprivileged 所以主进程
# 不以 root 身份运行。 Image 默认侦听 8080 而不是 80；网关
# / admin 容器映射必须以 8080 为目标。 Docker-compose.prod.yml 已经
# 使用 `"${ADMIN_PORT:-7894}:80"` — 当此图像登陆时将其更新为 :8080。
FROM nginxinc/nginx-unprivileged:alpine AS runner

USER root
# 安全：删除默认的 nginx 配置
RUN rm -rf /etc/nginx/conf.d/default.conf

# 复制 nginx 配置
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

# 复制构建的文件
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

# 设置权限，然后返回到非特权用户。
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html
USER nginx

EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
