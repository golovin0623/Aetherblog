package com.aetherblog.common.core.exception;

import com.aetherblog.common.core.enums.ResultCode;

/**
 * 认证异常
 */
public class AuthException extends RuntimeException {

    private final int code;

    public AuthException(String message) {
        super(message);
        this.code = ResultCode.UNAUTHORIZED.getCode();
    }

    public AuthException(int code, String message) {
        super(message);
        this.code = code;
    }

    public AuthException(ResultCode resultCode) {
        super(resultCode.getMessage());
        this.code = resultCode.getCode();
    }

    public int getCode() {
        return code;
    }
}
