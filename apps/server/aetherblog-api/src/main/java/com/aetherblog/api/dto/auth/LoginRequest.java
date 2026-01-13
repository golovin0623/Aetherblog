package com.aetherblog.api.dto.auth;

import jakarta.validation.constraints.NotBlank;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 登录请求 DTO (Record)
 */
@Schema(description = "登录请求")
public record LoginRequest(
    @Schema(description = "用户名或邮箱", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "用户名不能为空")
    String username,

    @Schema(description = "密码", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "密码不能为空")
    String password,

    @Schema(description = "是否已加密")
    Boolean encrypted
) {
    public LoginRequest {
        if (encrypted == null) {
            encrypted = false;
        }
    }
}
