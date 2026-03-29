# =============================================================================
# AetherBlog Go Backend - Multi-stage Build
# Target: <30 MB image, <100ms startup
# =============================================================================

FROM golang:1.24-alpine AS builder
WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# Production: alpine-based minimal image
# Using alpine instead of scratch for: timezone data, /tmp, /app dirs, shell for healthcheck
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
