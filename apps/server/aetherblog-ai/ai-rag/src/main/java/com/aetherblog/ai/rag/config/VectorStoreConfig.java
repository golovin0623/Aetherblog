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
    @org.springframework.context.annotation.Bean
    public org.springframework.ai.vectorstore.VectorStore vectorStore(
            org.springframework.jdbc.core.JdbcTemplate jdbcTemplate,
            org.springframework.ai.embedding.EmbeddingModel embeddingModel) {
        
        // 由于缺少 starter 组件，需要手动配置
        return org.springframework.ai.vectorstore.pgvector.PgVectorStore.builder(jdbcTemplate, embeddingModel)
                .dimensions(1536) // OpenAI text-embedding-3-small
                .indexType(org.springframework.ai.vectorstore.pgvector.PgVectorStore.PgIndexType.HNSW)
                .distanceType(org.springframework.ai.vectorstore.pgvector.PgVectorStore.PgDistanceType.COSINE_DISTANCE)
                .build();
    }
}
