package com.aetherblog.blog.dto.request;

import jakarta.validation.constraints.NotBlank;

/**
 * VanBlog 导入模式请求
 */
public record ImportVanBlogRequest(
        @NotBlank(message = "导入模式不能为空")
        String mode
) {}
