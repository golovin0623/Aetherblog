package com.aetherblog.common.core.domain;

import com.aetherblog.common.core.enums.ResultCode;
import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.experimental.Accessors;

import java.io.Serializable;

/**
 * 统一API响应结果封装
 *
 * @param <T> 数据类型
 */
@Data
@Accessors(chain = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
@Schema(description = "统一响应结果")
public class R<T> implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "状态码", example = "200")
    private int code;

    @Schema(description = "消息", example = "操作成功")
    private String message;

    @Schema(description = "响应数据")
    private T data;

    @Schema(description = "时间戳")
    private long timestamp;

    @Schema(description = "链路追踪ID")
    private String traceId;

    private R() {
        this.timestamp = System.currentTimeMillis();
    }

    public static <T> R<T> ok() {
        return ok(null);
    }

    public static <T> R<T> ok(T data) {
        return new R<T>()
                .setCode(ResultCode.SUCCESS.getCode())
                .setMessage(ResultCode.SUCCESS.getMessage())
                .setData(data);
    }

    public static <T> R<T> ok(T data, String message) {
        return new R<T>()
                .setCode(ResultCode.SUCCESS.getCode())
                .setMessage(message)
                .setData(data);
    }

    public static <T> R<T> fail() {
        return fail(ResultCode.FAILURE);
    }

    public static <T> R<T> fail(String message) {
        return new R<T>()
                .setCode(ResultCode.FAILURE.getCode())
                .setMessage(message);
    }

    public static <T> R<T> fail(ResultCode resultCode) {
        return new R<T>()
                .setCode(resultCode.getCode())
                .setMessage(resultCode.getMessage());
    }

    public static <T> R<T> fail(int code, String message) {
        return new R<T>()
                .setCode(code)
                .setMessage(message);
    }
}
