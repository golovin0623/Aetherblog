package com.aetherblog.ai.rag.config;

import org.springframework.context.annotation.Configuration;

/**
 * 向量存储配置
 * 
 * PgVectorStore 通过 spring-ai-pgvector-store-spring-boot-starter 自动配置
 * 需要配置以下属性:
 * - spring.ai.vectorstore.pgvector.index-type: HNSW
 * - spring.ai.vectorstore.pgvector.distance-type: COSINE_DISTANCE
 * - spring.ai.vectorstore.pgvector.dimensions: 1536
 */
@Configuration
public class VectorStoreConfig {
    // VectorStore bean is auto-configured by spring-ai-pgvector-store-spring-boot-starter
}
