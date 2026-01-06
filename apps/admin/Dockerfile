# syntax=docker/dockerfile:1

# =============================================================================
# AetherBlog Admin - Vite React Admin Panel
# =============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/admin/package.json ./apps/admin/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY apps/admin ./apps/admin

# Build the application (uses relative /api path, nginx proxies to backend)
RUN pnpm --filter @aetherblog/admin build

# Stage 2: Production with Nginx
FROM nginx:alpine AS runner

# Copy nginx configuration
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
