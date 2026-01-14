package com.aetherblog.blog.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 创建文章请求 (Record)
 */
public record CreatePostRequest(
    @NotBlank(message = "标题不能为空")
    @Size(max = 200, message = "标题最多200字符")
    String title,

    @NotBlank(message = "内容不能为空")
    String content,

    @Size(max = 500, message = "摘要最多500字符")
    String summary,

    String coverImage,

    Long categoryId,

    List<Long> tagIds,

    String status
) {
    public CreatePostRequest {
        if (status == null) {
            status = "DRAFT";
        }
    }
}
