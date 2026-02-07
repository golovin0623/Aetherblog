package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.Category;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface CategoryRepository extends JpaRepository<Category, Long> {

    Optional<Category> findBySlug(String slug);

    List<Category> findByParentIsNullOrderBySortOrderAsc();

    List<Category> findByParentIdOrderBySortOrderAsc(Long parentId);

    Optional<Category> findByName(String name);

    boolean existsByName(String name);
}
