package com.aetherblog.common.core.constant;

/**
 * 缓存常量
 */
public final class CacheConstants {

    private CacheConstants() {}

    /** 缓存前缀 */
    public static final String CACHE_PREFIX = "aetherblog:";

    /** 用户缓存 */
    public static final String USER_CACHE = CACHE_PREFIX + "user:";

    /** 文章缓存 */
    public static final String POST_CACHE = CACHE_PREFIX + "post:";

    /** 分类缓存 */
    public static final String CATEGORY_CACHE = CACHE_PREFIX + "category:";

    /** 标签缓存 */
    public static final String TAG_CACHE = CACHE_PREFIX + "tag:";

    /** 热门文章缓存 */
    public static final String HOT_POSTS_CACHE = CACHE_PREFIX + "hot_posts";

    /** Token缓存 */
    public static final String TOKEN_CACHE = CACHE_PREFIX + "token:";

    /** 验证码缓存 */
    public static final String CAPTCHA_CACHE = CACHE_PREFIX + "captcha:";

    /** 限流缓存 */
    public static final String RATE_LIMIT_CACHE = CACHE_PREFIX + "rate_limit:";

    /** 默认过期时间（秒）*/
    public static final long DEFAULT_EXPIRE = 3600L;

    /** 短期过期时间（秒）*/
    public static final long SHORT_EXPIRE = 300L;

    /** 长期过期时间（秒）*/
    public static final long LONG_EXPIRE = 86400L;
}
