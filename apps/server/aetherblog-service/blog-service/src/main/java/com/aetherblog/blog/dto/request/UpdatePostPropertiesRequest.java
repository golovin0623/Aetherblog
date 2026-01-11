package com.aetherblog.blog.dto.request;

import jakarta.validation.constraints.Size;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 更新文章属性请求 (快速编辑，不包含内容)
 *
 * @author AI Assistant
 * @since 1.0.0
 */
@Data
public class UpdatePostPropertiesRequest {

    @Size(max = 200, message = "文章标题不能超过200字符")
    private String title;

    @Size(max = 500, message = "文章摘要不能超过500字符")
    private String summary;

    private String coverImage;

    private Long categoryId;

    private List<Long> tagIds;

    private String status;

    /**
     * 是否置顶
     */
    private Boolean isPinned;

    /**
     * 置顶优先级 (数值越大优先级越高)
     */
    private Integer pinPriority;

    /**
     * 是否允许评论
     */
    private Boolean allowComment;

    /**
     * 文章密码 (加密访问)
     */
    private String password;

    /**
     * 自定义路径名
     */
    private String slug;

    /**
     * 创建时间 (可修改)
     */
    private LocalDateTime createdAt;
}
