package com.aetherblog.blog.dto.response;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 文章详情响应
 */
@Data
public class PostDetailResponse {

    private Long id;
    private String title;
    private String slug;
    private String content;
    private String summary;
    private String coverImage;
    private String status;
    private CategoryInfo category;
    private List<TagInfo> tags;
    private Long viewCount;
    private Long commentCount;
    private Long likeCount;
    private LocalDateTime publishedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @Data
    public static class CategoryInfo {
        private Long id;
        private String name;
        private String slug;
    }

    @Data
    public static class TagInfo {
        private Long id;
        private String name;
        private String slug;
        private String color;
    }
}
