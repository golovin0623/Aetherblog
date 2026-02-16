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
    @Pattern(regexp = "^(https?:\\/\\/)\\S+$", message = "头像地址必须以http或https开头，且不包含空格")
    @Size(max = 500, message = "头像地址长度不能超过500个字符")
    private String avatarUrl;
}
