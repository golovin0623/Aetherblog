package com.aetherblog.common.core.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 响应码枚举
 */
@Getter
@AllArgsConstructor
public enum ResultCode {

    SUCCESS(200, "操作成功"),
    FAILURE(500, "操作失败"),
    
    // 客户端错误 4xx
    BAD_REQUEST(400, "请求参数错误"),
    UNAUTHORIZED(401, "未授权"),
    FORBIDDEN(403, "禁止访问"),
    NOT_FOUND(404, "资源不存在"),
    METHOD_NOT_ALLOWED(405, "方法不允许"),
    REQUEST_TIMEOUT(408, "请求超时"),
    TOO_MANY_REQUESTS(429, "请求过于频繁"),
    
    // 服务端错误 5xx
    INTERNAL_ERROR(500, "服务器内部错误"),
    SERVICE_UNAVAILABLE(503, "服务不可用"),
    
    // 业务错误 1xxx
    PARAM_MISS(1001, "缺少必要参数"),
    PARAM_TYPE_ERROR(1002, "参数类型错误"),
    DATA_NOT_FOUND(1003, "数据不存在"),
    DATA_ALREADY_EXISTS(1004, "数据已存在"),
    DATA_SAVE_FAILED(1005, "数据保存失败"),
    
    // 认证授权 2xxx
    TOKEN_EXPIRED(2001, "Token已过期"),
    TOKEN_INVALID(2002, "Token无效"),
    LOGIN_FAILED(2003, "登录失败"),
    ACCOUNT_DISABLED(2004, "账户已禁用"),
    NO_PERMISSION(2005, "没有权限");

    private final int code;
    private final String message;
}
