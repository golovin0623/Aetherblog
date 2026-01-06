package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.Category;
import com.aetherblog.blog.service.CategoryService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 博客前台分类接口
 */
@Tag(name = "博客前台分类", description = "公开访问的分类接口")
@RestController
@RequestMapping("/v1/public/categories")
@RequiredArgsConstructor
public class PublicCategoryController {

    private final CategoryService categoryService;

    @Operation(summary = "获取所有分类")
    @GetMapping
    public R<List<Category>> list() {
        return R.ok(categoryService.getAllCategories());
    }
}
