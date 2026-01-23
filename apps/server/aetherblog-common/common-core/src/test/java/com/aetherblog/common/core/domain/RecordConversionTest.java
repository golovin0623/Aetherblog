package com.aetherblog.common.core.domain;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.Collections;

class RecordConversionTest {

    @Test
    void testPageQueryDefaults() {
        // 测试通过规范构造函数使用越界值时的默认构造函数行为
        PageQuery query = new PageQuery(0, 0, null, null);
        
        assertEquals(1, query.pageNum(), "PageNum should default to 1");
        assertEquals(10, query.pageSize(), "PageSize should default to 10");
        assertEquals("desc", query.orderDirection(), "OrderDirection should default to desc");
        
        // 测试偏移量计算
        assertEquals(0, query.getOffset(), "Offset should be 0 for page 1");
        
        PageQuery query2 = new PageQuery(2, 20, "id", "asc");
        assertEquals(20, query2.getOffset(), "Offset should be 20 for page 2, size 20");
    }

    @Test
    void testPageResult() {
        PageResult<String> result = new PageResult<>(Collections.singletonList("test"), 100L, 1, 10);
        
        assertEquals(1, result.list().size());
        assertEquals("test", result.list().get(0));
        assertEquals(100L, result.total());
        assertEquals(1, result.pageNum());
        assertEquals(10, result.pageSize());
        
        // 工厂方法
        PageResult<String> result2 = PageResult.of(Collections.emptyList(), 0L, 1, 10);
        assertEquals(0, result2.total());
    }

    @Test
    void testR() {
        R<String> success = R.ok("data");
        assertEquals(200, success.code());
        assertEquals("data", success.data());
        assertTrue(success.timestamp() > 0);
        
        R<Void> fail = R.fail("error");
        assertEquals(500, fail.code()); // 假设 ResultCode.FAILURE 为 500
        assertEquals("error", fail.message());
    }
}
