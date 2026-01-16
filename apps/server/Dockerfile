# =============================================================================
# AetherBlog 后端 - Spring Boot 应用程序
# 多平台支持：linux/amd64 (CentOS 7), linux/arm64 (Mac M1/M2)
# =============================================================================

# 第一阶段：构建 (JDK 25 + Spring Boot 3.5.0-M2)
FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-25 AS builder
WORKDIR /app

# 优先复制 Maven 文件以利用依赖缓存 (所有子模块的 pom.xml 文件)
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

# 复制源代码
COPY apps/server ./

# 使用优化设置构建应用程序 (针对网络问题包含重试机制)
RUN --mount=type=cache,target=/root/.m2 \
    mvn clean package -DskipTests -B -T 1C || \
    (sleep 5 && mvn clean package -DskipTests -B -T 1C) || \
    (sleep 10 && mvn clean package -DskipTests -B -T 1C)

# 第二阶段：生产环境
FROM eclipse-temurin:25-jre-alpine AS runner
WORKDIR /app

# 安装健康检查和容器监控所需的软件包
RUN apk add --no-cache curl docker-cli

# 添加非 root 用户
RUN addgroup --system --gid 1001 spring && \
    adduser --system --uid 1001 --ingroup spring spring

# 复制构建好的 jar 包
COPY --from=builder /app/aetherblog-app/target/*.jar app.jar

# 创建上传目录并更改所有权
RUN mkdir -p /app/uploads && \
    chown -R spring:spring /app/uploads && \
    chown spring:spring app.jar

# USER spring

EXPOSE 8080

# JDK 25 优化的 JVM 设置：
# === 内存管理 ===
# - UseContainerSupport: 自动检测容器内存限制
# - MaxRAMPercentage: 使用高达 75% 的容器内存作为堆内存
# - InitialRAMPercentage: 初始堆内存为最大值的 50% 以加快启动速度
# - UseCompactObjectHeaders: JDK 25 Lilliput 项目 (节省 10-15% 内存)
#
# === 垃圾回收 ===
# - UseZGC: Z 垃圾回收器 (JDK 25 中默认为分代)
#
# === 启动优化 ===
# - TieredStopAtLevel=1: 仅使用快速 C1 编译以加快启动速度
#
# === 安全与可靠性 ===
# - ExitOnOutOfMemoryError: OOM 时快速失败，以便容器编排
#
# 注意：CDS 已禁用 - 与 UseCompactObjectHeaders + UseZGC 不兼容
# 注意：ZGenerational 已移除 - JDK 25 中已成为默认值，标志已弃用
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
