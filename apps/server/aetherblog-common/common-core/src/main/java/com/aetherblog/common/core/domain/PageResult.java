package com.aetherblog.common.core.domain;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.List;

/**
 * 分页结果封装
 */
@Data
@Schema(description = "分页结果")
public class PageResult<T> {

    @Schema(description = "数据列表")
    private List<T> list;

    @Schema(description = "总记录数")
    private long total;

    @Schema(description = "当前页码")
    private int pageNum;

    @Schema(description = "每页数量")
    private int pageSize;

    @Schema(description = "总页数")
    private int pages;

    public PageResult() {}

    public PageResult(List<T> list, long total, int pageNum, int pageSize) {
        this.list = list;
        this.total = total;
        this.pageNum = pageNum;
        this.pageSize = pageSize;
        this.pages = (int) Math.ceil((double) total / pageSize);
    }

    public static <T> PageResult<T> of(List<T> list, long total, int pageNum, int pageSize) {
        return new PageResult<>(list, total, pageNum, pageSize);
    }
}
