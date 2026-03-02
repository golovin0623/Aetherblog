package com.aetherblog.blog.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;
import java.util.List;

/**
 * 更新文章请求
 */
@Data
public class UpdatePostRequest {

    @NotBlank(message = "文章标题不能为空")
    @Size(max = 200, message = "文章标题不能超过200字符")
    private String title;

    @NotBlank(message = "文章内容不能为空")
    private String content;

    @Size(max = 500, message = "文章摘要不能超过500字符")
    private String summary;

    @Pattern(regexp = "^(https?:\\/\\/|\\/)[^\"']+$", message = "封面图片必须是合法的URL (以http/https或/开头, 且不能包含引号)")
    private String coverImage;

    private Long categoryId;

    private List<Long> tagIds;

    private String status;
}
