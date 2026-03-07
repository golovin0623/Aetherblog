package com.aetherblog.blog.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.LocalDateTime;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record VanBlogArticlePayload(
        Integer id,
        String title,
        String content,
        List<String> tags,
        Integer top,
        String category,
        Boolean hidden,
        @JsonProperty("private")
        Boolean privateValue,
        String password,
        Boolean deleted,
        String author,
        String pathname,
        Long viewer,
        Long visited,
        String copyright,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public Boolean privateValue() {
        return privateValue;
    }
}
