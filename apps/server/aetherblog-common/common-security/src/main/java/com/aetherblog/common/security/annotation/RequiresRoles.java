package com.aetherblog.common.security.annotation;

import java.lang.annotation.*;

/**
 * 需要角色注解
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RequiresRoles {

    /**
     * 需要的角色
     */
    String[] value() default {};

    /**
     * 逻辑关系：AND / OR
     */
    Logical logical() default Logical.AND;

    enum Logical {
        AND, OR
    }
}
