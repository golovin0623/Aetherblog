package com.aetherblog.blog.service;

import com.aetherblog.blog.dto.request.CreatePostRequest;
import com.aetherblog.blog.dto.request.UpdatePostPropertiesRequest;
import com.aetherblog.blog.dto.response.PostDetailResponse;
import com.aetherblog.blog.dto.response.PostListResponse;
import com.aetherblog.blog.entity.Post;
import com.aetherblog.common.core.domain.PageResult;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 文章服务接口
 */
public interface PostService {

    List<Post> getAllPublishedPosts();

    PageResult<PostListResponse> getPublishedPosts(int pageNum, int pageSize);

    /**
     * 管理后台获取文章列表（支持状态筛选、关键词搜索及高级筛选）
     * 
     * @param status       状态筛选：PUBLISHED, DRAFT, ARCHIVED 等
     * @param keyword      搜索关键词（匹配标题或内容）
     * @param categoryId   分类ID
     * @param tagId        标签ID
     * @param minViewCount 最小浏览量
     * @param maxViewCount 最大浏览量
     * @param startDate    开始时间（创建时间）
     * @param endDate      结束时间（创建时间）
     * @param pageNum      页码
     * @param pageSize     每页数量
     * @return 分页结果
     */
    PageResult<PostListResponse> getPostsForAdmin(
            String status, 
            String keyword, 
            Long categoryId,
            Long tagId,
            Integer minViewCount,
            Integer maxViewCount,
            LocalDateTime startDate,
            LocalDateTime endDate,
            int pageNum, 
            int pageSize);

    PageResult<PostListResponse> getPostsByCategory(Long categoryId, int pageNum, int pageSize);

    PageResult<PostListResponse> getPostsByTag(Long tagId, int pageNum, int pageSize);

    PostDetailResponse getPostById(Long id);

    PostDetailResponse getPostBySlug(String slug);

    PostDetailResponse createPost(CreatePostRequest request);

    PostDetailResponse updatePost(Long id, CreatePostRequest request);

    /**
     * 更新文章属性 (快速编辑，不包含内容)
     * @param id 文章ID
     * @param request 属性更新请求
     * @return 更新后的文章详情
     */
    PostDetailResponse updatePostProperties(Long id, UpdatePostPropertiesRequest request);

    /**
     * 保存文章草稿 (缓存到Redis, 7天过期)
     * @param id 文章ID
     * @param request 草稿内容
     */
    void saveDraft(Long id, CreatePostRequest request);

    void deletePost(Long id);

    void publishPost(Long id);

    void incrementViewCount(Long id);
}
