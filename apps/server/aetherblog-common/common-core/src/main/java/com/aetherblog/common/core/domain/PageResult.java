package com.aetherblog.common.core.domain;

import io.swagger.v3.oas.annotations.media.Schema;


import java.util.List;

/**
 * 分页结果封装
 */
@Schema(description = "分页结果")
public record PageResult<T>(
    @Schema(description = "数据列表") List<T> list,
    @Schema(description = "总记录数") long total,
    @Schema(description = "当前页码") int pageNum,
    @Schema(description = "每页数量") int pageSize,
    @Schema(description = "总页数") int pages
) {
    public PageResult(List<T> list, long total, int pageNum, int pageSize) {
        this(list, total, pageNum, pageSize, (int) Math.ceil((double) total / pageSize));
    }

    public static <T> PageResult<T> of(List<T> list, long total, int pageNum, int pageSize) {
        return new PageResult<>(list, total, pageNum, pageSize);
    }
}
