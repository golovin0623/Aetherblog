package com.aetherblog.common.log.annotation;

import java.lang.annotation.*;

/**
 * 操作日志注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Log {

    /**
     * 模块名称
     */
    String module() default "";

    /**
     * 操作类型
     */
    OperationType type() default OperationType.OTHER;

    /**
     * 操作描述
     */
    String description() default "";

    /**
     * 是否记录请求参数
     */
    boolean saveRequestData() default true;

    /**
     * 是否记录响应数据
     */
    boolean saveResponseData() default true;

    enum OperationType {
        CREATE, UPDATE, DELETE, QUERY, IMPORT, EXPORT, LOGIN, LOGOUT, OTHER
    }
}
