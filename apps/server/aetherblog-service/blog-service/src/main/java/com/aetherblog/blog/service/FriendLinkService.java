package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.FriendLink;
import com.aetherblog.common.core.domain.PageResult;

import java.util.List;

/**
 * 友链服务接口
 * 
 * @ref §8.2-7 - 友链管理模块
 */
public interface FriendLinkService {

    /**
     * 获取所有友链
     */
    List<FriendLink> listAll();

    /**
     * 获取可见友链（前台展示用）
     */
    List<FriendLink> listVisible();

    /**
     * 分页获取友链列表（管理后台）
     */
    PageResult<FriendLink> listPage(int pageNum, int pageSize);

    /**
     * 根据ID获取友链
     */
    FriendLink getById(Long id);

    /**
     * 创建友链
     */
    FriendLink create(FriendLink friendLink);

    /**
     * 更新友链
     */
    FriendLink update(Long id, FriendLink friendLink);

    /**
     * 删除友链
     */
    void delete(Long id);

    /**
     * 批量删除友链
     */
    void batchDelete(List<Long> ids);

    /**
     * 切换可见状态
     */
    FriendLink toggleVisible(Long id);

    /**
     * 更新排序
     */
    void updateSortOrder(Long id, Integer sortOrder);
}
