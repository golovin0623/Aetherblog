package com.aetherblog.common.security.annotation;

import java.lang.annotation.*;
import java.util.concurrent.TimeUnit;

/**
 * 限流注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RateLimit {

    /**
     * 限流key（默认使用方法名）
     */
    String key() default "";

    /**
     * 时间窗口内最大请求数
     */
    int count() default 100;

    /**
     * 时间窗口
     */
    int time() default 60;

    /**
     * 时间单位
     */
    TimeUnit timeUnit() default TimeUnit.SECONDS;

    /**
     * 限流类型
     */
    LimitType limitType() default LimitType.DEFAULT;

    enum LimitType {
        DEFAULT, IP, USER
    }
}
