package com.aetherblog.blog.dto.request;

import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 更新文章属性请求 (快速编辑，不包含内容) (Record)
 *
 * @author AI Assistant
 * @since 1.0.0
 */
public record UpdatePostPropertiesRequest(
    @Size(max = 200, message = "文章标题不能超过200字符")
    String title,

    @Size(max = 500, message = "文章摘要不能超过500字符")
    String summary,

    String coverImage,

    Long categoryId,

    List<Long> tagIds,

    String status,

    /**
     * 是否置顶
     */
    Boolean isPinned,

    /**
     * 置顶优先级 (数值越大优先级越高)
     */
    Integer pinPriority,

    /**
     * 是否允许评论
     */
    Boolean allowComment,

    /**
     * 文章密码 (加密访问)
     */
    String password,

    /**
     * 自定义路径名
     */
    String slug,

    /**
     * 创建时间 (可修改)
     */
    LocalDateTime createdAt
) {}
