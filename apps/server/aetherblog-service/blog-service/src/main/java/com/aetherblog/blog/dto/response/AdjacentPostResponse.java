package com.aetherblog.blog.dto.response;

import lombok.Data;

/**
 * 相邻文章响应 DTO
 * 用于文章详情页的"上一篇 / 下一篇"导航
 */
@Data
public class AdjacentPostResponse {

    /** 上一篇（较旧） */
    private PostBrief prevPost;

    /** 下一篇（较新） */
    private PostBrief nextPost;

    @Data
    public static class PostBrief {
        private String slug;
        private String title;
    }
}
