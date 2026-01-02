package com.aetherblog.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

/**
 * 创建文章请求 DTO
 */
@Data
public class CreatePostRequest {

    @NotBlank(message = "标题不能为空")
    @Size(max = 200, message = "标题最多200字符")
    private String title;

    @NotBlank(message = "内容不能为空")
    private String content;

    private String summary;

    private String coverImage;

    private Long categoryId;

    private List<Long> tagIds;

    private String status = "DRAFT";
}
