# syntax=docker/dockerfile:1

# =============================================================================
# AetherBlog Frontend - Next.js Blog
# Multi-platform: linux/amd64 (CentOS 7), linux/arm64 (Mac M1/M2)
# =============================================================================

# 第一阶段：依赖
FROM --platform=$BUILDPLATFORM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 安装特定版本的 pnpm 以保证可重复性
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# 复制包文件
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/blog/package.json ./apps/blog/

# 安装依赖（使用缓存挂载）
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 第二阶段：构建
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

# 设置构建环境变量
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ADMIN_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:8080}
ENV NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL:-/admin/}

# 使用内存限制构建应用
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN pnpm --filter @aetherblog/blog build

# 第三阶段：生产环境（目标平台）
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 创建用户和组
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# 复制构建好的文件
COPY --from=builder /app/apps/blog/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/blog/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/blog/.next/static ./apps/blog/.next/static

USER nextjs

EXPOSE 3000

# 针对容器的 Node.js 内存优化
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=512"

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "apps/blog/server.js"]
