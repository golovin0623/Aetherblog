# syntax=docker/dockerfile:1

# =============================================================================
# AetherBlog Backend - Spring Boot Application
# Multi-platform: linux/amd64 (CentOS 7), linux/arm64 (Mac M1/M2)
# =============================================================================

# Stage 1: Build
FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app

# Copy Maven files first for dependency caching (all submodule pom.xml files)
COPY apps/server/pom.xml ./
# aetherblog-common and its submodules
COPY apps/server/aetherblog-common/pom.xml ./aetherblog-common/
COPY apps/server/aetherblog-common/common-core/pom.xml ./aetherblog-common/common-core/
COPY apps/server/aetherblog-common/common-security/pom.xml ./aetherblog-common/common-security/
COPY apps/server/aetherblog-common/common-redis/pom.xml ./aetherblog-common/common-redis/
COPY apps/server/aetherblog-common/common-log/pom.xml ./aetherblog-common/common-log/
# aetherblog-ai and its submodules
COPY apps/server/aetherblog-ai/pom.xml ./aetherblog-ai/
COPY apps/server/aetherblog-ai/ai-core/pom.xml ./aetherblog-ai/ai-core/
COPY apps/server/aetherblog-ai/ai-agent/pom.xml ./aetherblog-ai/ai-agent/
COPY apps/server/aetherblog-ai/ai-prompt/pom.xml ./aetherblog-ai/ai-prompt/
COPY apps/server/aetherblog-ai/ai-rag/pom.xml ./aetherblog-ai/ai-rag/
# aetherblog-service and its submodules
COPY apps/server/aetherblog-service/pom.xml ./aetherblog-service/
COPY apps/server/aetherblog-service/blog-service/pom.xml ./aetherblog-service/blog-service/
# aetherblog-api and aetherblog-app
COPY apps/server/aetherblog-api/pom.xml ./aetherblog-api/
COPY apps/server/aetherblog-app/pom.xml ./aetherblog-app/

# Download dependencies (with retry for network issues)
RUN --mount=type=cache,target=/root/.m2 \
    mvn dependency:go-offline -B || mvn dependency:go-offline -B

# Copy source code
COPY apps/server ./

# Build the application with optimal settings
RUN --mount=type=cache,target=/root/.m2 \
    mvn clean package -DskipTests -B -T 1C

# Stage 2: Production
FROM eclipse-temurin:21-jre-alpine AS runner
WORKDIR /app

# Install required packages for health checks and container monitoring
RUN apk add --no-cache curl docker-cli

# Add non-root user
RUN addgroup --system --gid 1001 spring && \
    adduser --system --uid 1001 --ingroup spring spring

# Copy the built jar
COPY --from=builder /app/aetherblog-app/target/*.jar app.jar

# Create uploads directory and change ownership
RUN mkdir -p /app/uploads && \
    chown -R spring:spring /app/uploads && \
    chown spring:spring app.jar

# USER spring

EXPOSE 8080

# Container-aware JVM settings:
# - UseContainerSupport: Automatically detect container memory limits
# - MaxRAMPercentage: Use up to 75% of container memory for heap
# - InitialRAMPercentage: Start with 50% of max for faster startup
# - G1GC: Best GC for containers with predictable latency
# - ExitOnOutOfMemoryError: Fail fast on OOM for container restart
ENV JAVA_OPTS="-XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0 \
    -XX:+UseG1GC \
    -XX:+ExitOnOutOfMemoryError \
    -Djava.security.egd=file:/dev/./urandom"

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
