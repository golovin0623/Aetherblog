# 语法=Docker/Dockerfile:1

# =============================================================================
# AetherBlog 前端 - Next.js 博客
# 多平台：linux/amd64 (CentOS 7)、linux/arm64 (Mac M1/M2)
# =============================================================================

# 第一阶段：依赖关系
FROM --platform=$BUILDPLATFORM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 安装具有特定版本的 pnpm 以实现可重复性
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# 复制包文件
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/blog/package.json ./apps/blog/

# 使用缓存挂载安装依赖项
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 第二阶段：构建
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/blog/node_modules ./apps/blog/node_modules
COPY . .

# 设置构建环境变量
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ADMIN_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:8080}
ENV NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL:-/admin/}

# 确保运行时复制的公用文件夹存在，即使存储库没有
RUN mkdir -p /app/apps/blog/public

# 构建具有内存限制的应用程序
# .next/cache 的缓存挂载在 Docker 构建中保留 Next.js 构建缓存
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN --mount=type=cache,target=/app/apps/blog/.next/cache \
    pnpm --filter @aetherblog/blog build

# 第三阶段：生产（目标平台）
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 创建用户和组
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# 复制构建的文件
COPY --from=builder /app/apps/blog/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/blog/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/blog/.next/static ./apps/blog/.next/static

USER nextjs

EXPOSE 3000

# Node.js 容器内存优化
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=512"

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "apps/blog/server.js"]
