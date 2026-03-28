# =============================================================================
# AetherBlog Go Backend - Multi-stage Build
# Target: <30 MB image, <100ms startup
# =============================================================================

FROM golang:1.23-alpine AS builder
WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# Production: scratch image (minimal)
FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/server /server
COPY --from=builder /app/config.yaml /config.yaml

EXPOSE 8080

ENTRYPOINT ["/server"]
