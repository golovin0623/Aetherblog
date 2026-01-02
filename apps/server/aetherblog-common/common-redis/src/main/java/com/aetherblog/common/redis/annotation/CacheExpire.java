package com.aetherblog.common.redis.annotation;

import java.lang.annotation.*;
import java.util.concurrent.TimeUnit;

/**
 * 缓存过期注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CacheExpire {

    /**
     * 缓存key
     */
    String key();

    /**
     * 过期时间
     */
    long expire() default 3600;

    /**
     * 时间单位
     */
    TimeUnit timeUnit() default TimeUnit.SECONDS;

    /**
     * 是否使用方法参数作为key的一部分
     */
    boolean useArgs() default true;
}
