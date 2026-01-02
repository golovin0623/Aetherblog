package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.entity.Post.PostStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 文章数据仓库
 */
@Repository
public interface PostRepository extends JpaRepository<Post, Long> {

    Optional<Post> findBySlug(String slug);

    boolean existsBySlug(String slug);

    List<Post> findAllByStatusOrderByPublishedAtDesc(PostStatus status);

    Page<Post> findByStatus(PostStatus status, Pageable pageable);

    @Query("SELECT p FROM Post p WHERE p.status = 'PUBLISHED' ORDER BY p.publishedAt DESC")
    Page<Post> findPublished(Pageable pageable);

    @Query("SELECT p FROM Post p WHERE p.category.id = :categoryId AND p.status = 'PUBLISHED'")
    Page<Post> findByCategoryId(@Param("categoryId") Long categoryId, Pageable pageable);

    @Query("SELECT p FROM Post p JOIN p.tags t WHERE t.id = :tagId AND p.status = 'PUBLISHED'")
    Page<Post> findByTagId(@Param("tagId") Long tagId, Pageable pageable);

    @Query("SELECT p FROM Post p WHERE p.status = 'PUBLISHED' ORDER BY p.viewCount DESC")
    Page<Post> findHotPosts(Pageable pageable);
}
