# =============================================================================
# AetherBlog Go Backend - Multi-stage Build
# Target: <30 MB image, <100ms startup
# =============================================================================

FROM golang:1.24-alpine AS builder
WORKDIR /app

# Cache dependencies (context is project root, source is apps/server-go/)
COPY apps/server-go/go.mod apps/server-go/go.sum ./
RUN go mod download

# Copy source and build
COPY apps/server-go/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# Production: alpine-based minimal image
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
    && mkdir -p /app/uploads /app/logs /app/migrations

WORKDIR /app
COPY --from=builder /app/server /app/server
COPY --from=builder /app/config.yaml /app/config.yaml
COPY --from=builder /app/migrations /app/migrations

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=5s \
    CMD ["/app/server", "-health"]

ENTRYPOINT ["/app/server"]
