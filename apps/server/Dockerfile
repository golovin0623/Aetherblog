# =============================================================================
# AetherBlog Backend - Spring Boot Application
# Multi-platform: linux/amd64 (CentOS 7), linux/arm64 (Mac M1/M2)
# =============================================================================

# Stage 1: Build (JDK 25 + Spring Boot 3.5.0-M2)
FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-25 AS builder
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

# Copy source code
COPY apps/server ./

# Build the application with optimal settings (with retry for network issues)
RUN --mount=type=cache,target=/root/.m2 \
    mvn clean package -DskipTests -B -T 1C || \
    (sleep 5 && mvn clean package -DskipTests -B -T 1C) || \
    (sleep 10 && mvn clean package -DskipTests -B -T 1C)

# Stage 2: Production
FROM eclipse-temurin:25-jre-alpine AS runner
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

# JDK 25 Optimized JVM Settings:
# === Memory Management ===
# - UseContainerSupport: Auto-detect container memory limits
# - MaxRAMPercentage: Use up to 75% of container memory for heap
# - InitialRAMPercentage: Start with 50% of max for faster startup
# - UseCompactObjectHeaders: JDK 25 Lilliput project (10-15% memory savings)
#
# === Garbage Collection ===
# - UseZGC: Z Garbage Collector (generational by default in JDK 25)
#
# === Startup Optimization ===
# - TieredStopAtLevel=1: Quick C1 compilation only for faster startup
#
# === Security & Reliability ===
# - ExitOnOutOfMemoryError: Fail fast on OOM for container orchestration
#
# NOTE: CDS disabled - incompatible with UseCompactObjectHeaders + UseZGC
# NOTE: ZGenerational removed - now default in JDK 25, flag deprecated
ENV JAVA_OPTS="-XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0 \
    -XX:+UseZGC \
    -XX:+UnlockExperimentalVMOptions \
    -XX:+UseCompactObjectHeaders \
    -XX:TieredStopAtLevel=1 \
    -XX:+ExitOnOutOfMemoryError \
    -Djava.security.egd=file:/dev/./urandom"

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
