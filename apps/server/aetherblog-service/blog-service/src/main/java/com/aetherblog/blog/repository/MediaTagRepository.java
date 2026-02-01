package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.MediaTag;
import com.aetherblog.blog.entity.MediaTag.TagCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 媒体标签仓储接口
 *
 * @ref 媒体库深度优化方案 - Phase 2: 智能标签系统
 * @author AI Assistant
 * @since 2.2.0
 */
@Repository
public interface MediaTagRepository extends JpaRepository<MediaTag, Long> {

    /**
     * 根据slug查找标签
     */
    Optional<MediaTag> findBySlug(String slug);

    /**
     * 根据名称查找标签
     */
    Optional<MediaTag> findByName(String name);

    /**
     * 检查标签名称是否存在
     */
    boolean existsByName(String name);

    /**
     * 检查slug是否存在
     */
    boolean existsBySlug(String slug);

    /**
     * 根据分类查找标签
     */
    List<MediaTag> findByCategoryOrderByUsageCountDesc(TagCategory category);

    /**
     * 获取最常用的标签
     */
    List<MediaTag> findTop20ByOrderByUsageCountDesc();

    /**
     * 搜索标签（按名称模糊匹配）
     */
    @Query("SELECT t FROM MediaTag t WHERE t.name LIKE %:keyword% ORDER BY t.usageCount DESC")
    List<MediaTag> searchByKeyword(@Param("keyword") String keyword);

    /**
     * 增加标签使用次数
     */
    @Modifying
    @Query("UPDATE MediaTag t SET t.usageCount = t.usageCount + 1 WHERE t.id = :tagId")
    void incrementUsageCount(@Param("tagId") Long tagId);

    /**
     * 减少标签使用次数
     */
    @Modifying
    @Query("UPDATE MediaTag t SET t.usageCount = t.usageCount - 1 WHERE t.id = :tagId AND t.usageCount > 0")
    void decrementUsageCount(@Param("tagId") Long tagId);

    /**
     * 获取未使用的标签
     */
    List<MediaTag> findByUsageCountOrderByCreatedAtDesc(int usageCount);
}
