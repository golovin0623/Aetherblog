# 🛠 升级问题记录 (Issue Log)

## [2026-01-14] JDK 25 & Spring Boot 4.0 升级适配

### 1. 核心技术栈变更
- **JDK**: 21 -> 25
- **Spring Boot**: 3.4.1 -> 4.0.0
- **Spring AI**: 1.0.0-M5 -> 2.0.0-M1
- **Jackson**: 2.x -> 3.x (`tools.jackson.*`)

### 2. 遇到的问题与解决方案

#### 2.1 Jackson 3.x 迁移
- **问题**: Spring Boot 4 全面转向 Jackson 3 (`tools.jackson` 包名)，旧的 `com.fasterxml.jackson` 代码无法编译。
- **改动**:
  - 全局替换包名: `com.fasterxml.jackson` -> `tools.jackson`
  - API 调整: 
    - `JsonProcessingException` -> `JacksonException`
    - `new ObjectMapper()` -> `JsonMapper.builder().build()`
  - **临时方案**: 本地缺少 `jackson-datatype-jsr310:3.0.3` artifact，暂时在 `JsonUtils.java` 中注释掉了 `JavaTimeModule` 的注册 (FIXME)。

#### 2.2 Spring AI 2.0.0-M1 兼容性
- **问题 1**: `spring-ai-pgvector-store-spring-boot-starter:2.0.0-M1` 缺失，导致 `VectorStore` Bean 无法自动配置，应用启动失败。
- **解决**: 
  - 回退 `ai-rag` 依赖为 `spring-ai-pgvector-store` (核心库)。
  - 新增 `VectorStoreConfig.java` 手动配置 `PgVectorStore` Bean，使用 `PgVectorStore.builder()` (注意 API 变更: 构造函数私有化)。

- **问题 2**: `UnsatisfiedDependencyException` - `VectorStore` 依赖 `EmbeddingModel`，但 `ai-core` 使用的是 `spring-ai-openai` 核心库而非 Starter，导致没有自动配置 `EmbeddingModel`。
- **解决**:
  - 在 `SpringAiConfig.java` 中手动注册 `OpenAiEmbeddingModel` Bean。
  - 构造函数适配: `new OpenAiEmbeddingModel(api, MetadataMode.EMBED, options)`。

#### 2.3 编译与构建
- **问题**: `ai-agent` 模块报错 `ChatService cannot be resolved`，即时 `ai-core` 代码已更新。
- **解决**: 对 `ai-core` 执行 `mvn clean install` 强制更新本地仓库，确保 `ai-agent` 能读取到最新的类定义。

#### 2.4 JDK 25 警告
- **现象**: 启动时 `Unsafe` 类调用警告 (JEP 471)。
- **状态**: 这是一个 Known Issue，目前仅为警告，不影响功能，需等待 Guava/Spring 等底层库适配。

---
