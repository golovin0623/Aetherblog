package com.aetherblog.api.dto.auth;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 修改密码请求 DTO
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ChangePasswordRequest {

    /**
     * 当前密码（可能是加密后的）
     */
    @NotBlank(message = "当前密码不能为空")
    private String currentPassword;

    /**
     * 新密码（可能是加密后的）
     */
    @NotBlank(message = "新密码不能为空")
    private String newPassword;

    /**
     * 是否已加密
     */
    private Boolean encrypted = false;
}
