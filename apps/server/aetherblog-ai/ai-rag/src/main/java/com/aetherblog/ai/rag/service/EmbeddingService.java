package com.aetherblog.ai.rag.service;

import lombok.RequiredArgsConstructor;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * 文档嵌入服务
 */
@Service
@RequiredArgsConstructor
public class EmbeddingService {

    private final VectorStore vectorStore;

    /**
     * 添加文档到向量存储
     */
    public void addDocument(String id, String content, Map<String, Object> metadata) {
        Document document = new Document(id, content, metadata);
        vectorStore.add(List.of(document));
    }

    /**
     * 批量添加文档
     */
    public void addDocuments(List<Document> documents) {
        vectorStore.add(documents);
    }

    /**
     * 删除文档
     */
    public void deleteDocuments(List<String> ids) {
        vectorStore.delete(ids);
    }

    /**
     * 相似性搜索
     */
    public List<Document> similaritySearch(String query, int topK) {
        return vectorStore.similaritySearch(
                SearchRequest.query(query).withTopK(topK)
        );
    }

    /**
     * 带过滤的相似性搜索
     */
    public List<Document> similaritySearch(String query, int topK, double threshold) {
        return vectorStore.similaritySearch(
                SearchRequest.query(query)
                        .withTopK(topK)
                        .withSimilarityThreshold(threshold)
        );
    }
}
