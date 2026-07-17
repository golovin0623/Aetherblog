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
# Vite can exceed Node's default ~2GB heap in CI/buildx when bundling the admin app.
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm --filter @aetherblog/admin build

# Stage 2: Production with Nginx (unprivileged)
# SECURITY (VULN-124): keep the master process non-root and listen on 8080.
#
# The Debian variant is deliberate. Alpine 3.24's userspace issues pwritev2 on
# startup; CentOS 7's 3.10 kernel + libseccomp 2.3.1 turns the unknown syscall
# into EPERM instead of ENOSYS, so nginx cannot fall back and exits while
# writing its PID file. The Trixie build was verified on the production host
# with Docker's default seccomp profile. Pin the multi-arch manifest digest so
# a mutable registry tag cannot silently reintroduce the outage.
FROM nginxinc/nginx-unprivileged:1.30.4-trixie@sha256:ed5de4a59d636ea196825a0b7cee5f4819999e4d56672e4e12df5cf686bdd0c5 AS runner

USER root
# The pinned unprivileged image already ships curl and redirects its PID plus
# all request/proxy temp paths into /tmp. Enforce those assumptions while the
# image is built: the production container deliberately exposes only /tmp as a
# writable tmpfs instead of reopening /var/cache/nginx or /var/run.
RUN command -v curl >/dev/null && \
    grep -Eq '^[[:space:]]*pid[[:space:]]+/tmp/nginx\.pid;' /etc/nginx/nginx.conf && \
    grep -Eq '^[[:space:]]*client_body_temp_path[[:space:]]+/tmp/' /etc/nginx/nginx.conf && \
    rm -rf /etc/nginx/conf.d/default.conf

# Copy nginx configuration
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

# Set permissions then drop back to the unprivileged user.
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html
USER nginx

EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:8080/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
