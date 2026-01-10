# syntax=docker/dockerfile:1

# =============================================================================
# AetherBlog Admin - Vite React Admin Panel
# Multi-platform: linux/amd64 (CentOS 7), linux/arm64 (Mac M1/M2)
# =============================================================================

# 第一阶段：构建
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 安装特定版本的 pnpm 以保证可重复性
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# 复制包文件
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/admin/package.json ./apps/admin/

# 安装依赖（使用缓存挂载）
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 复制源文件
COPY apps/admin ./apps/admin

# 构建应用（使用相对 /api 路径，nginx 代理到后端）
ENV NODE_ENV=production
RUN pnpm --filter @aetherblog/admin build

# 第二阶段：使用 Nginx 的生产环境
FROM nginx:alpine AS runner

# 安全：移除默认 nginx 配置
RUN rm -rf /etc/nginx/conf.d/default.conf

# 复制 nginx 配置
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

# 复制构建好的文件
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

# 安全：设置正确的权限
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
