package com.aetherblog.api.vo;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 文章视图对象
 */
@Data
public class PostVO {

    private Long id;
    private String title;
    private String slug;
    private String content;
    private String summary;
    private String coverImage;
    private String status;
    private Long categoryId;
    private String categoryName;
    private List<TagVO> tags;
    private Long viewCount;
    private Long commentCount;
    private LocalDateTime publishedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @Data
    public static class TagVO {
        private Long id;
        private String name;
        private String color;
    }
}
