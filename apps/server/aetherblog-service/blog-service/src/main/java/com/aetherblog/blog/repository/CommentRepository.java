package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.Comment;
import com.aetherblog.blog.entity.Comment.CommentStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CommentRepository extends JpaRepository<Comment, Long> {

    Page<Comment> findByPostIdAndStatus(Long postId, CommentStatus status, Pageable pageable);

    List<Comment> findByPostIdAndParentIsNullAndStatus(Long postId, CommentStatus status);

    long countByPostIdAndStatus(Long postId, CommentStatus status);

    Page<Comment> findByStatus(CommentStatus status, Pageable pageable);
}
