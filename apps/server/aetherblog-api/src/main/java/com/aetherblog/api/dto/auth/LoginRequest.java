package com.aetherblog.api.dto.auth;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 登录请求 DTO
 */
@Data
public class LoginRequest {

    /**
     * 用户名或邮箱
     */
    @NotBlank(message = "用户名不能为空")
    private String username;

    /**
     * 密码（可能是加密后的）
     */
    @NotBlank(message = "密码不能为空")
    private String password;

    /**
     * 是否已加密
     */
    private Boolean encrypted = false;
}
