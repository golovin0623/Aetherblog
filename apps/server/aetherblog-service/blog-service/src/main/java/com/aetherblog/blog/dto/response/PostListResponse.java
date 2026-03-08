package com.aetherblog.blog.dto.response;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 文章列表项响应
 */
@Data
public class PostListResponse {

    private Long id;
    private String title;
    private String slug;
    private String summary;
    private String coverImage;
    private String status;
    private String categoryName;
    private List<String> tagNames;
    private Long viewCount;
    private Long commentCount;
    private Boolean isPinned;
    private Integer pinPriority;
    private Boolean isHidden;
    private Boolean passwordRequired;
    private LocalDateTime publishedAt;
    private LocalDateTime createdAt;
}
