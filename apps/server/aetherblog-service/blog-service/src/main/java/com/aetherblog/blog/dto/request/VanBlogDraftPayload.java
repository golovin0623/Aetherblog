package com.aetherblog.blog.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.LocalDateTime;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record VanBlogDraftPayload(
        Integer id,
        String title,
        String content,
        List<String> tags,
        String category,
        String author,
        Boolean deleted,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {}
