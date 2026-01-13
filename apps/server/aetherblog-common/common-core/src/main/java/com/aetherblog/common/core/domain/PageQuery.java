package com.aetherblog.common.core.domain;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 分页查询参数
 */
@Schema(description = "分页查询参数")
public record PageQuery(
    @Schema(description = "页码", example = "1") int pageNum,
    @Schema(description = "每页数量", example = "10") int pageSize,
    @Schema(description = "排序字段") String orderBy,
    @Schema(description = "排序方向 (asc/desc)") String orderDirection
) {
    public PageQuery {
        if (pageNum < 1) pageNum = 1;
        if (pageSize < 1) pageSize = 10;
        if (orderDirection == null || orderDirection.isEmpty()) orderDirection = "desc";
    }

    public int getOffset() {
        return (pageNum - 1) * pageSize;
    }
}
