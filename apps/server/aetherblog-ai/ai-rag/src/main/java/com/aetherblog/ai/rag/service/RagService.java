package com.aetherblog.ai.rag.service;

import com.aetherblog.ai.core.service.ChatService;
import lombok.RequiredArgsConstructor;
import org.springframework.ai.document.Document;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * RAG 检索服务
 */
@Service
@RequiredArgsConstructor
public class RagService {

    private final EmbeddingService embeddingService;
    private final ChatService chatService;

    private static final String RAG_PROMPT_TEMPLATE = """
        基于以下上下文回答用户问题。如果上下文中没有相关信息，请明确说明。

        上下文:
        %s

        用户问题: %s

        请基于上下文提供准确的回答:
        """;

    /**
     * RAG 问答
     */
    public String query(String question) {
        return query(question, 5, 0.7);
    }

    /**
     * RAG 问答（带参数）
     */
    public String query(String question, int topK, double threshold) {
        // 1. 检索相关文档
        List<Document> documents = embeddingService.similaritySearch(question, topK, threshold);

        if (documents.isEmpty()) {
            return "抱歉，未找到相关信息。";
        }

        // 2. 构建上下文
        String context = documents.stream()
                .map(Document::getText)
                .collect(Collectors.joining("\n\n"));

        // 3. 生成回答
        String prompt = String.format(RAG_PROMPT_TEMPLATE, context, question);
        return chatService.chat(prompt);
    }

    /**
     * 索引文章内容
     */
    public void indexPost(Long postId, String title, String content) {
        String documentContent = title + "\n\n" + content;
        embeddingService.addDocument(
                "post_" + postId,
                documentContent,
                java.util.Map.of("type", "post", "postId", postId, "title", title)
        );
    }

    /**
     * 删除文章索引
     */
    public void removePostIndex(Long postId) {
        embeddingService.deleteDocuments(List.of("post_" + postId));
    }
}
