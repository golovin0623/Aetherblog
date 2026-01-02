package com.aetherblog.common.core.constant;

/**
 * 安全相关常量
 */
public class SecurityConstants {

    /**
     * 认证请求头
     */
    public static final String AUTHORIZATION_HEADER = "Authorization";

    /**
     * Bearer前缀
     */
    public static final String BEARER_PREFIX = "Bearer ";

    /**
     * 用户ID请求头
     */
    public static final String USER_ID_HEADER = "X-User-Id";

    /**
     * 用户名请求头
     */
    public static final String USERNAME_HEADER = "X-Username";

    /**
     * 角色请求头
     */
    public static final String ROLES_HEADER = "X-Roles";

    /**
     * 登录用户缓存前缀
     */
    public static final String LOGIN_USER_KEY = "login_user:";

    /**
     * Token黑名单前缀
     */
    public static final String TOKEN_BLACKLIST_KEY = "token_blacklist:";

    /**
     * 密码最小长度
     */
    public static final int PASSWORD_MIN_LENGTH = 6;

    /**
     * 密码最大长度
     */
    public static final int PASSWORD_MAX_LENGTH = 20;

    private SecurityConstants() {}
}
