package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.Category;
import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.service.CategoryService;
import com.aetherblog.common.core.exception.BusinessException;
import com.aetherblog.common.core.utils.SlugUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 分类服务实现
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class CategoryServiceImpl implements CategoryService {

    private final CategoryRepository categoryRepository;

    @Override
    public List<Category> getAllCategories() {
        return categoryRepository.findAll();
    }

    @Override
    public List<Category> getRootCategories() {
        return categoryRepository.findByParentIsNullOrderBySortOrderAsc();
    }

    @Override
    public Category getCategoryById(Long id) {
        return categoryRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "分类不存在"));
    }

    @Override
    public Category getCategoryBySlug(String slug) {
        return categoryRepository.findBySlug(slug)
                .orElseThrow(() -> new BusinessException(404, "分类不存在"));
    }

    @Override
    @Transactional
    public Category createCategory(Category category) {
        if (category.getSlug() == null || category.getSlug().isEmpty()) {
            category.setSlug(SlugUtils.toSlug(category.getName()));
        }
        return categoryRepository.save(category);
    }

    @Override
    @Transactional
    public Category updateCategory(Long id, Category category) {
        Category existing = getCategoryById(id);
        existing.setName(category.getName());
        existing.setDescription(category.getDescription());
        existing.setIcon(category.getIcon());
        existing.setSortOrder(category.getSortOrder());
        return categoryRepository.save(existing);
    }

    @Override
    @Transactional
    public void deleteCategory(Long id) {
        categoryRepository.deleteById(id);
    }
}
