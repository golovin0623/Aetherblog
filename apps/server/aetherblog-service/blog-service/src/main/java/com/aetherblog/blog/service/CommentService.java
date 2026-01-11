package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.Comment;
import com.aetherblog.blog.entity.Comment.CommentStatus;
import com.aetherblog.common.core.domain.PageResult;

import java.util.List;

/**
 * 评论服务接口
 * 
 * @ref §3.2-11 - 评论管理模块
 */
public interface CommentService {

    /**
     * 获取待审核评论列表
     */
    PageResult<Comment> listPending(int pageNum, int pageSize);

    /**
     * 获取所有评论列表（管理后台）
     */
    PageResult<Comment> listAll(CommentStatus status, int pageNum, int pageSize);

    /**
     * 获取文章的评论列表（已审核通过）
     */
    PageResult<Comment> listByPost(Long postId, int pageNum, int pageSize);

    /**
     * 获取评论详情
     */
    Comment getById(Long id);

    /**
     * 创建评论（前台访客提交）
     */
    Comment create(Long postId, Comment comment);

    /**
     * 审核通过
     */
    Comment approve(Long id);

    /**
     * 审核拒绝
     */
    Comment reject(Long id);

    /**
     * 标记为垃圾评论
     */
    Comment markAsSpam(Long id);

    /**
     * 还原评论
     */
    Comment restore(Long id);

    /**
     * 软删除评论（移至回收站）
     */
    void delete(Long id);

    /**
     * 彻底删除评论
     */
    void permanentDelete(Long id);

    /**
     * 批量删除评论（软删除）
     */
    void batchDelete(List<Long> ids);

    /**
     * 批量彻底删除评论
     */
    void batchPermanentDelete(List<Long> ids);

    /**
     * 批量审核通过
     */
    void batchApprove(List<Long> ids);

    /**
     * 获取文章评论数
     */
    long countByPost(Long postId);

    /**
     * 回复评论
     */
    Comment reply(Long parentId, Comment comment);
}
