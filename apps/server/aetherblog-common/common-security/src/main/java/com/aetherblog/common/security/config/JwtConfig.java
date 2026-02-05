package com.aetherblog.common.security.config;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

/**
 * JWT 配置属性
 */
@Data
@Component
@Validated
@ConfigurationProperties(prefix = "jwt")
public class JwtConfig {

    /**
     * 密钥
     */
    @NotBlank(message = "JWT Secret must be configured")
    private String secret;

    /**
     * 过期时间（毫秒）
     */
    private Long expiration = 86400000L; // 24小时

    /**
     * 刷新Token过期时间（毫秒）
     */
    private Long refreshExpiration = 604800000L; // 7天

    /**
     * Token前缀
     */
    private String tokenPrefix = "Bearer ";

    /**
     * 请求头名称
     */
    private String headerName = "Authorization";
}
