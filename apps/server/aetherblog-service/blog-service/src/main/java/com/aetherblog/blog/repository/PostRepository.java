package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.entity.Post.PostStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.stereotype.Repository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.List;
import java.util.Optional;

/**
 * 文章数据仓库
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §6.1 - 核心表结构
 */
@Repository
public interface PostRepository extends JpaRepository<Post, Long>, JpaSpecificationExecutor<Post> {

    Optional<Post> findBySlug(String slug);

    Optional<Post> findBySourceKey(String sourceKey);

    boolean existsBySlug(String slug);

    boolean existsBySlugAndIdNot(String slug, Long id);

    List<Post> findAllByStatusOrderByPublishedAtDesc(PostStatus status);

    Page<Post> findByStatus(PostStatus status, Pageable pageable);

    @Query("SELECT p FROM Post p WHERE p.status = 'PUBLISHED' AND p.deleted = false AND p.isHidden = false ORDER BY p.publishedAt DESC")
    Page<Post> findPublished(Pageable pageable);

    @Query("SELECT p FROM Post p WHERE p.slug = :slug AND p.status = 'PUBLISHED' AND p.deleted = false AND p.isHidden = false")
    Optional<Post> findPublicBySlug(@Param("slug") String slug);

    @Query("SELECT p FROM Post p WHERE p.category.id = :categoryId AND p.status = 'PUBLISHED' AND p.deleted = false AND p.isHidden = false")
    Page<Post> findByCategoryId(@Param("categoryId") Long categoryId, Pageable pageable);

    @Query("SELECT p FROM Post p JOIN p.tags t WHERE t.id = :tagId AND p.status = 'PUBLISHED' AND p.deleted = false AND p.isHidden = false")
    Page<Post> findByTagId(@Param("tagId") Long tagId, Pageable pageable);

    @Query("SELECT p FROM Post p WHERE p.status = 'PUBLISHED' AND p.deleted = false AND p.isHidden = false ORDER BY p.viewCount DESC")
    Page<Post> findHotPosts(Pageable pageable);

    /**
     * 查找比当前文章更新的已发布文章（下一篇）
     */
    @Query("SELECT p FROM Post p WHERE p.publishedAt > :publishedAt AND p.status = 'PUBLISHED' AND p.deleted = false AND p.isHidden = false ORDER BY p.publishedAt ASC")
    Page<Post> findNextPublished(@Param("publishedAt") java.time.LocalDateTime publishedAt, Pageable pageable);

    /**
     * 查找比当前文章更旧的已发布文章（上一篇）
     */
    @Query("SELECT p FROM Post p WHERE p.publishedAt < :publishedAt AND p.status = 'PUBLISHED' AND p.deleted = false AND p.isHidden = false ORDER BY p.publishedAt DESC")
    Page<Post> findPrevPublished(@Param("publishedAt") java.time.LocalDateTime publishedAt, Pageable pageable);

    @Query("SELECT p FROM Post p ORDER BY p.createdAt DESC")
    Page<Post> findAllOrderByCreatedAtDesc(Pageable pageable);

    @Query("SELECT p FROM Post p WHERE LOWER(p.title) LIKE LOWER(CONCAT('%', :keyword, '%')) ORDER BY p.createdAt DESC")
    Page<Post> findByKeyword(@Param("keyword") String keyword, Pageable pageable);

    @Query("SELECT p FROM Post p WHERE p.status = :status AND LOWER(p.title) LIKE LOWER(CONCAT('%', :keyword, '%')) ORDER BY p.createdAt DESC")
    Page<Post> findByStatusAndKeyword(@Param("status") PostStatus status, @Param("keyword") String keyword, Pageable pageable);

    /**
     * 统计时间范围内新增文章数
     */
    @Query("SELECT COUNT(p) FROM Post p WHERE p.createdAt BETWEEN :startTime AND :endTime")
    int countByCreatedAtBetween(@Param("startTime") java.time.LocalDateTime startTime, @Param("endTime") java.time.LocalDateTime endTime);

    /**
     * 统计指定时间之后新增的文章数 (包含起始时间)
     */
    long countByCreatedAtGreaterThanEqual(java.time.LocalDateTime dateTime);

    @Modifying
    @Query(value = """
            WITH _cfg AS (
                SELECT set_config('app.preserve_updated_at', 'true', true)
            )
            UPDATE posts
            SET created_at = :createdAt,
                updated_at = :updatedAt,
                published_at = :publishedAt,
                view_count = :viewCount,
                is_hidden = :isHidden,
                legacy_author_name = :legacyAuthorName,
                legacy_visited_count = :legacyVisitedCount,
                legacy_copyright = :legacyCopyright,
                source_key = :sourceKey
            FROM _cfg
            WHERE id = :id
            """, nativeQuery = true)
    void applyImportMetadata(
            @Param("id") Long id,
            @Param("createdAt") java.time.LocalDateTime createdAt,
            @Param("updatedAt") java.time.LocalDateTime updatedAt,
            @Param("publishedAt") java.time.LocalDateTime publishedAt,
            @Param("viewCount") Long viewCount,
            @Param("isHidden") Boolean isHidden,
            @Param("legacyAuthorName") String legacyAuthorName,
            @Param("legacyVisitedCount") Long legacyVisitedCount,
            @Param("legacyCopyright") String legacyCopyright,
            @Param("sourceKey") String sourceKey
    );
}
