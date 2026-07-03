# =============================================================================
# AetherBlog Go 后端 - 多阶段构建
# 目标：<30 MB 图像，<100 毫秒启动
# =============================================================================

FROM golang:1.24-alpine AS builder
WORKDIR /app

# 缓存依赖项（上下文是项目根目录，源是 apps/server-Go/）
COPY apps/server-go/go.mod apps/server-go/go.sum ./
RUN go mod download

# 复制源并构建
COPY apps/server-go/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o migrate ./cmd/migrate

# 制作：基于 alpine 的最小图像
# 使用 alpine 而不是 scrap 来进行：时区数据、/tmp、/app 目录、用于健康检查的 shell
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
    && mkdir -p /app/uploads /app/logs /app/migrations

WORKDIR /app
COPY --from=builder /app/server /app/server
COPY --from=builder /app/migrate /app/migrate
COPY --from=builder /app/config.yaml /app/config.yaml
COPY --from=builder /app/migrations /app/migrations

# 创建非 root 用户。
# /app/logs 扩大到模式 0775，因此共享的 aetherblog_logs 卷保持不变
# ai-service 的组可写（也是 UID 1001 / GID 1001）。镜像
# apps/ai-service/Dockerfile 中的匹配更改。
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -D appuser
RUN chown -R appuser:appgroup /app && chmod 0775 /app/logs

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=5s \
    CMD ["/app/server", "-health"]

ENTRYPOINT ["/app/server"]
