package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.Category;
import com.aetherblog.blog.service.CategoryService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 分类管理控制器
 */
@Tag(name = "分类管理", description = "分类CRUD接口")
@RestController
@RequestMapping("/v1/admin/categories")
@RequiredArgsConstructor
public class CategoryController {

    private final CategoryService categoryService;

    @Operation(summary = "获取所有分类")
    @GetMapping
    public R<List<Category>> list() {
        return R.ok(categoryService.getAllCategories());
    }

    @Operation(summary = "获取分类详情")
    @GetMapping("/{id}")
    public R<Category> getById(@PathVariable Long id) {
        return R.ok(categoryService.getCategoryById(id));
    }

    @Operation(summary = "创建分类")
    @PostMapping
    public R<Category> create(@RequestBody Category category) {
        return R.ok(categoryService.createCategory(category));
    }

    @Operation(summary = "更新分类")
    @PutMapping("/{id}")
    public R<Category> update(@PathVariable Long id, @RequestBody Category category) {
        return R.ok(categoryService.updateCategory(id, category));
    }

    @Operation(summary = "删除分类")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        categoryService.deleteCategory(id);
        return R.ok();
    }
}
