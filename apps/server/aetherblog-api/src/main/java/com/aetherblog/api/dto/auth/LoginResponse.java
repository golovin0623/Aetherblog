package com.aetherblog.api.dto.auth;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 登录响应 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LoginResponse {

    /**
     * 访问令牌
     */
    private String accessToken;

    /**
     * 令牌类型
     */
    @Builder.Default
    private String tokenType = "Bearer";

    /**
     * 过期时间（秒）
     */
    private Long expiresIn;

    /**
     * 用户信息
     */
    private UserInfoVO userInfo;

    /**
     * 是否需要修改密码
     */
    @Builder.Default
    private Boolean mustChangePassword = false;

    /**
     * 用户信息 VO
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UserInfoVO {
        private Long id;
        private String username;
        private String email;
        private String nickname;
        private String avatar;
        private String role;
    }
}
