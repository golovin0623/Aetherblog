package com.aetherblog.api.dto.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 更新头像请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UpdateAvatarRequest {

    @NotBlank(message = "头像地址不能为空")
    @Pattern(regexp = "^(https?://\\S+|/uploads/\\S+)$", message = "头像地址格式无效，需要以http/https开头或使用系统存储路径")
    @Size(max = 500, message = "头像地址长度不能超过500个字符")
    private String avatarUrl;
}
