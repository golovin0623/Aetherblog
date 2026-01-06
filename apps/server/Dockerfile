# syntax=docker/dockerfile:1

# =============================================================================
# AetherBlog Backend - Spring Boot Application
# =============================================================================

# Stage 1: Build
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app

# Copy Maven files first for dependency caching
COPY apps/server/pom.xml ./
COPY apps/server/aetherblog-common/pom.xml ./aetherblog-common/
COPY apps/server/aetherblog-service/pom.xml ./aetherblog-service/
COPY apps/server/aetherblog-ai/pom.xml ./aetherblog-ai/
COPY apps/server/aetherblog-api/pom.xml ./aetherblog-api/
COPY apps/server/aetherblog-app/pom.xml ./aetherblog-app/

# Download dependencies
RUN mvn dependency:go-offline -B

# Copy source code
COPY apps/server ./

# Build the application
RUN mvn clean package -DskipTests -B

# Stage 2: Production
FROM eclipse-temurin:21-jre-alpine AS runner
WORKDIR /app

# Add non-root user
RUN addgroup --system --gid 1001 spring
RUN adduser --system --uid 1001 spring

# Copy the built jar
COPY --from=builder /app/aetherblog-app/target/*.jar app.jar

# Change ownership
RUN chown spring:spring app.jar

USER spring

EXPOSE 8080

ENV JAVA_OPTS="-Xms512m -Xmx1024m -XX:+UseG1GC"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
