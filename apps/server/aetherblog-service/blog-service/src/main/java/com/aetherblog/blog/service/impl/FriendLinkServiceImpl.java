package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.FriendLink;
import com.aetherblog.blog.repository.FriendLinkRepository;
import com.aetherblog.blog.service.FriendLinkService;
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
 * 友链服务实现类
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §8.2-7 - 友链管理模块
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FriendLinkServiceImpl implements FriendLinkService {

    private final FriendLinkRepository friendLinkRepository;

    @Override
    public List<FriendLink> listAll() {
        return friendLinkRepository.findAll(Sort.by(Sort.Direction.ASC, "sortOrder"));
    }

    @Override
    public List<FriendLink> listVisible() {
        return friendLinkRepository.findByVisibleTrueOrderBySortOrderAsc();
    }

    @Override
    public PageResult<FriendLink> listPage(int pageNum, int pageSize) {
        Page<FriendLink> page = friendLinkRepository.findAll(
                PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.ASC, "sortOrder")));
        return new PageResult<>(
                page.getContent(),
                page.getTotalElements(),
                pageNum,
                pageSize
        );
    }

    @Override
    public FriendLink getById(Long id) {
        Objects.requireNonNull(id, "友链ID不能为空");
        return friendLinkRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "友链不存在: " + id));
    }

    @Override
    @Transactional
    public FriendLink create(FriendLink friendLink) {
        Objects.requireNonNull(friendLink, "友链对象不能为空");
        // 设置默认排序值
        if (friendLink.getSortOrder() == null) {
            Long maxOrder = friendLinkRepository.findMaxSortOrder();
            friendLink.setSortOrder(maxOrder != null ? maxOrder.intValue() + 1 : 0);
        }
        log.info("创建友链: name={}, url={}", friendLink.getName(), friendLink.getUrl());
        return friendLinkRepository.save(friendLink);
    }

    @Override
    @Transactional
    public FriendLink update(Long id, FriendLink friendLink) {
        Objects.requireNonNull(id, "友链ID不能为空");
        Objects.requireNonNull(friendLink, "友链对象不能为空");
        FriendLink existing = getById(id);
        existing.setName(friendLink.getName());
        existing.setUrl(friendLink.getUrl());
        existing.setLogo(friendLink.getLogo());
        existing.setDescription(friendLink.getDescription());
        existing.setSortOrder(friendLink.getSortOrder());
        existing.setVisible(friendLink.getVisible());
        log.info("更新友链: id={}, name={}", id, friendLink.getName());
        return friendLinkRepository.save(existing);
    }

    @Override
    @Transactional
    public void delete(Long id) {
        Objects.requireNonNull(id, "友链ID不能为空");
        if (!friendLinkRepository.existsById(id)) {
            throw new BusinessException(404, "友链不存在: " + id);
        }
        friendLinkRepository.deleteById(id);
        log.info("删除友链: id={}", id);
    }

    @Override
    @Transactional
    public void batchDelete(List<Long> ids) {
        Objects.requireNonNull(ids, "ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }
        friendLinkRepository.deleteAllById(ids);
        log.info("批量删除友链: ids={}", ids);
    }

    @Override
    @Transactional
    public FriendLink toggleVisible(Long id) {
        Objects.requireNonNull(id, "友链ID不能为空");
        FriendLink existing = getById(id);
        existing.setVisible(!Boolean.TRUE.equals(existing.getVisible()));
        log.info("切换友链可见状态: id={}, visible={}", id, existing.getVisible());
        return friendLinkRepository.save(existing);
    }

    @Override
    @Transactional
    public void updateSortOrder(Long id, Integer sortOrder) {
        Objects.requireNonNull(id, "友链ID不能为空");
        Objects.requireNonNull(sortOrder, "排序值不能为空");
        FriendLink existing = getById(id);
        existing.setSortOrder(sortOrder);
        friendLinkRepository.save(existing);
        log.info("更新友链排序: id={}, sortOrder={}", id, sortOrder);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void reorder(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return;
        }
        
        for (int i = 0; i < ids.size(); i++) {
            Long id = ids.get(i);
            final int sortOrder = i;
            friendLinkRepository.findById(id).ifPresent(friendLink -> {
                friendLink.setSortOrder(sortOrder);
                friendLinkRepository.save(friendLink);
            });
        }
        log.info("批量更新友链排序: count={}", ids.size());
    }
}
