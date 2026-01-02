package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.Category;
import java.util.List;

/**
 * 分类服务接口
 */
public interface CategoryService {

    List<Category> getAllCategories();

    List<Category> getRootCategories();

    Category getCategoryById(Long id);

    Category getCategoryBySlug(String slug);

    Category createCategory(Category category);

    Category updateCategory(Long id, Category category);

    void deleteCategory(Long id);
}
