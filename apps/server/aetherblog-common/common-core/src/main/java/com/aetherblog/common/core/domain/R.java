package com.aetherblog.common.core.domain;

import com.aetherblog.common.core.enums.ResultCode;
import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;

import java.io.Serializable;

/**
 * 统一API响应结果封装 (Record)
 *
 * @param <T> 数据类型
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@Schema(description = "统一响应结果")
public record R<T>(
        @Schema(description = "状态码", example = "200") int code,
        @Schema(description = "消息", example = "操作成功") String message,
        @Schema(description = "响应数据") T data,
        @Schema(description = "时间戳") long timestamp,
        @Schema(description = "链路追踪ID") String traceId
) implements Serializable {

    public R {
        if (timestamp == 0) {
            timestamp = System.currentTimeMillis();
        }
    }

    public static <T> R<T> ok() {
        return ok(null);
    }

    public static <T> R<T> ok(T data) {
        return new R<>(ResultCode.SUCCESS.getCode(), ResultCode.SUCCESS.getMessage(), data, System.currentTimeMillis(), null);
    }

    public static <T> R<T> ok(T data, String message) {
        return new R<>(ResultCode.SUCCESS.getCode(), message, data, System.currentTimeMillis(), null);
    }

    public static <T> R<T> fail() {
        return fail(ResultCode.FAILURE);
    }

    public static <T> R<T> fail(String message) {
        return new R<>(ResultCode.FAILURE.getCode(), message, null, System.currentTimeMillis(), null);
    }

    public static <T> R<T> fail(ResultCode resultCode) {
        return new R<>(resultCode.getCode(), resultCode.getMessage(), null, System.currentTimeMillis(), null);
    }

    public static <T> R<T> fail(int code, String message) {
        return new R<>(code, message, null, System.currentTimeMillis(), null);
    }
}
