# syntax=docker/dockerfile:1

# =============================================================================
# AetherBlog 后端 - Spring Boot 应用
# 多平台: linux/amd64 (CentOS 7), linux/arm64 (Mac M1/M2)
# =============================================================================

# 第一阶段：构建
FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app

# 首先复制 Maven 文件以进行依赖缓存（所有子模块 pom.xml 文件）
COPY apps/server/pom.xml ./
# aetherblog-common 及其子模块
COPY apps/server/aetherblog-common/pom.xml ./aetherblog-common/
COPY apps/server/aetherblog-common/common-core/pom.xml ./aetherblog-common/common-core/
COPY apps/server/aetherblog-common/common-security/pom.xml ./aetherblog-common/common-security/
COPY apps/server/aetherblog-common/common-redis/pom.xml ./aetherblog-common/common-redis/
COPY apps/server/aetherblog-common/common-log/pom.xml ./aetherblog-common/common-log/
# aetherblog-ai 及其子模块
COPY apps/server/aetherblog-ai/pom.xml ./aetherblog-ai/
COPY apps/server/aetherblog-ai/ai-core/pom.xml ./aetherblog-ai/ai-core/
COPY apps/server/aetherblog-ai/ai-agent/pom.xml ./aetherblog-ai/ai-agent/
COPY apps/server/aetherblog-ai/ai-prompt/pom.xml ./aetherblog-ai/ai-prompt/
COPY apps/server/aetherblog-ai/ai-rag/pom.xml ./aetherblog-ai/ai-rag/
# aetherblog-service 及其子模块
COPY apps/server/aetherblog-service/pom.xml ./aetherblog-service/
COPY apps/server/aetherblog-service/blog-service/pom.xml ./aetherblog-service/blog-service/
# aetherblog-api 和 aetherblog-app
COPY apps/server/aetherblog-api/pom.xml ./aetherblog-api/
COPY apps/server/aetherblog-app/pom.xml ./aetherblog-app/

# 下载依赖（针对网络问题进行重试）
RUN --mount=type=cache,target=/root/.m2 \
    mvn dependency:go-offline -B || mvn dependency:go-offline -B

# 复制源代码
COPY apps/server ./

# 使用最优设置构建应用
RUN --mount=type=cache,target=/root/.m2 \
    mvn clean package -DskipTests -B -T 1C

# 第二阶段：生产环境
FROM eclipse-temurin:21-jre-alpine AS runner
WORKDIR /app

# 安装健康检查所需的软件包
RUN apk add --no-cache curl

# 添加非 root 用户
RUN addgroup --system --gid 1001 spring && \
    adduser --system --uid 1001 --ingroup spring spring

# 复制构建好的 jar 包
COPY --from=builder /app/aetherblog-app/target/*.jar app.jar

# 创建 uploads 目录并更改所有权
RUN mkdir -p /app/uploads && \
    chown -R spring:spring /app/uploads && \
    chown spring:spring app.jar

USER spring

EXPOSE 8080

# 容器感知的 JVM 设置：
# - UseContainerSupport: 自动检测容器内存限制
# - MaxRAMPercentage: 使用高达 75% 的容器内存作为堆内存
# - InitialRAMPercentage: 以最大内存的 50% 启动，加快启动速度
# - G1GC: 最适合容器的可预测延迟 GC
# - ExitOnOutOfMemoryError: 发生 OOM 时快速失败以重启容器
ENV JAVA_OPTS="-XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0 \
    -XX:+UseG1GC \
    -XX:+ExitOnOutOfMemoryError \
    -Djava.security.egd=file:/dev/./urandom"

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
