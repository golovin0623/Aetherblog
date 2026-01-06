# syntax=docker/dockerfile:1

# =============================================================================
# AetherBlog Admin - Vite React Admin Panel
# Multi-platform: linux/amd64 (CentOS 7), linux/arm64 (Mac M1/M2)
# =============================================================================

# Stage 1: Build
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm with specific version for reproducibility
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/admin/package.json ./apps/admin/

# Install dependencies with cache mount
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source files
COPY apps/admin ./apps/admin

# Build the application (uses relative /api path, nginx proxies to backend)
ENV NODE_ENV=production
RUN pnpm --filter @aetherblog/admin build

# Stage 2: Production with Nginx
FROM nginx:alpine AS runner

# Security: Remove default nginx config
RUN rm -rf /etc/nginx/conf.d/default.conf

# Copy nginx configuration
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

# Security: Set proper permissions
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
