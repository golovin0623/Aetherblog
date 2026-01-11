package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.Comment;
import com.aetherblog.blog.entity.Comment.CommentStatus;
import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.repository.CommentRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.service.CommentService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;

/**
 * 评论服务实现类
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §3.2-11 - 评论管理模块
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CommentServiceImpl implements CommentService {

    private final CommentRepository commentRepository;
    private final PostRepository postRepository;

    @Override
    public PageResult<Comment> listPending(int pageNum, int pageSize) {
        Page<Comment> page = commentRepository.findByStatus(
                CommentStatus.PENDING,
                PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        return toPageResult(page, pageNum, pageSize);
    }

    @Override
    public PageResult<Comment> listAll(CommentStatus status, int pageNum, int pageSize) {
        Page<Comment> page;
        if (status != null) {
            page = commentRepository.findByStatus(status,
                    PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        } else {
            page = commentRepository.findAll(
                    PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        }
        return toPageResult(page, pageNum, pageSize);
    }

    @Override
    public PageResult<Comment> listByPost(Long postId, int pageNum, int pageSize) {
        Objects.requireNonNull(postId, "文章ID不能为空");
        Page<Comment> page = commentRepository.findByPostIdAndStatus(
                postId,
                CommentStatus.APPROVED,
                PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.ASC, "createdAt")));
        return toPageResult(page, pageNum, pageSize);
    }

    @Override
    public Comment getById(Long id) {
        Objects.requireNonNull(id, "评论ID不能为空");
        return commentRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "评论不存在: " + id));
    }

    @Override
    @Transactional
    public Comment create(Long postId, Comment comment) {
        Objects.requireNonNull(postId, "文章ID不能为空");
        Objects.requireNonNull(comment, "评论对象不能为空");
        
        Post post = postRepository.findById(postId)
                .orElseThrow(() -> new BusinessException(404, "文章不存在: " + postId));
        
        comment.setPost(post);
        comment.setStatus(CommentStatus.PENDING); // 默认待审核
        
        Comment saved = commentRepository.save(comment);
        log.info("创建评论: postId={}, nickname={}", postId, comment.getNickname());
        
        return saved;
    }

    @Override
    @Transactional
    public Comment approve(Long id) {
        Objects.requireNonNull(id, "评论ID不能为空");
        Comment comment = getById(id);
        comment.setStatus(CommentStatus.APPROVED);
        Comment saved = commentRepository.save(comment);
        
        // 更新文章评论数
        Post post = comment.getPost();
        if (post != null && post.getId() != null) {
            updatePostCommentCount(post.getId());
        }
        
        log.info("审核通过评论: id={}", id);
        return saved;
    }

    @Override
    @Transactional
    public Comment reject(Long id) {
        Objects.requireNonNull(id, "评论ID不能为空");
        Comment comment = getById(id);
        comment.setStatus(CommentStatus.REJECTED);
        log.info("审核拒绝评论: id={}", id);
        return commentRepository.save(comment);
    }

    @Override
    @Transactional
    public Comment markAsSpam(Long id) {
        Objects.requireNonNull(id, "评论ID不能为空");
        Comment comment = getById(id);
        comment.setStatus(CommentStatus.SPAM);
        log.info("标记为垃圾评论: id={}", id);
        return commentRepository.save(comment);
    }

    @Override
    @Transactional
    public Comment restore(Long id) {
        Objects.requireNonNull(id, "评论ID不能为空");
        Comment comment = getById(id);
        if (comment.getStatus() != CommentStatus.DELETED) {
            throw new BusinessException(400, "只有已删除的评论才能还原");
        }
        comment.setStatus(CommentStatus.APPROVED); // 还原后默认设为已通过
        Comment saved = commentRepository.save(comment);

        // 更新文章评论数
        Post post = comment.getPost();
        if (post != null && post.getId() != null) {
            updatePostCommentCount(post.getId());
        }

        log.info("还原评论: id={}", id);
        return saved;
    }

    @Override
    @Transactional
    public void delete(Long id) {
        Objects.requireNonNull(id, "评论ID不能为空");
        Comment comment = getById(id);

        // 如果已经是已删除状态，则不做任何操作（或者可以抛异常）
        if (comment.getStatus() == CommentStatus.DELETED) {
            return;
        }

        comment.setStatus(CommentStatus.DELETED);
        commentRepository.save(comment);

        // 更新文章评论数
        Post post = comment.getPost();
        if (post != null && post.getId() != null) {
            updatePostCommentCount(post.getId());
        }

        log.info("移至回收站: id={}", id);
    }

    @Override
    @Transactional
    public void permanentDelete(Long id) {
        Objects.requireNonNull(id, "评论ID不能为空");
        Comment comment = getById(id);
        Post post = comment.getPost();
        Long postId = (post != null) ? post.getId() : null;

        commentRepository.deleteById(id);

        // 更新文章评论数
        if (postId != null) {
            updatePostCommentCount(postId);
        }

        log.info("彻底删除评论: id={}", id);
    }

    @Override
    @Transactional
    public void batchDelete(List<Long> ids) {
        Objects.requireNonNull(ids, "ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }
        for (Long id : ids) {
            if (id != null) {
                delete(id);
            }
        }
        log.info("批量移至回收站: ids={}", ids);
    }

    @Override
    @Transactional
    public void batchPermanentDelete(List<Long> ids) {
        Objects.requireNonNull(ids, "ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }
        commentRepository.deleteAllById(ids);
        log.info("批量彻底删除评论: ids={}", ids);
    }

    @Override
    @Transactional
    public void batchApprove(List<Long> ids) {
        Objects.requireNonNull(ids, "ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }
        for (Long id : ids) {
            if (id != null) {
                approve(id);
            }
        }
        log.info("批量审核通过评论: ids={}", ids);
    }

    @Override
    public long countByPost(Long postId) {
        Objects.requireNonNull(postId, "文章ID不能为空");
        return commentRepository.countByPostIdAndStatus(postId, CommentStatus.APPROVED);
    }

    @Override
    @Transactional
    public Comment reply(Long parentId, Comment comment) {
        Objects.requireNonNull(parentId, "父评论ID不能为空");
        Objects.requireNonNull(comment, "评论对象不能为空");
        
        Comment parent = getById(parentId);
        comment.setPost(parent.getPost());
        comment.setParent(parent);
        comment.setStatus(CommentStatus.PENDING);
        
        log.info("回复评论: parentId={}, nickname={}", parentId, comment.getNickname());
        return commentRepository.save(comment);
    }

    /**
     * 更新文章评论数
     */
    private void updatePostCommentCount(Long postId) {
        Objects.requireNonNull(postId, "文章ID不能为空");
        long count = countByPost(postId);
        postRepository.findById(postId).ifPresent(post -> {
            post.setCommentCount(count);
            postRepository.save(post);
        });
    }

    private PageResult<Comment> toPageResult(Page<Comment> page, int pageNum, int pageSize) {
        return new PageResult<>(
                page.getContent(),
                page.getTotalElements(),
                pageNum,
                pageSize
        );
    }
}
