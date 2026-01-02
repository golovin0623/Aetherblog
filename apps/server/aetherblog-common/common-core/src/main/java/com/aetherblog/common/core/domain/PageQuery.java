package com.aetherblog.common.core.domain;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * 分页查询参数
 */
@Data
@Schema(description = "分页查询参数")
public class PageQuery {

    @Schema(description = "页码", example = "1")
    private int pageNum = 1;

    @Schema(description = "每页数量", example = "10")
    private int pageSize = 10;

    @Schema(description = "排序字段")
    private String orderBy;

    @Schema(description = "排序方向 (asc/desc)")
    private String orderDirection = "desc";

    public int getOffset() {
        return (pageNum - 1) * pageSize;
    }
}
