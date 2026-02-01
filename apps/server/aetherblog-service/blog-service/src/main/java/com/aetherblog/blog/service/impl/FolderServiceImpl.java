package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaFolder;
import com.aetherblog.blog.entity.MediaFolder.Visibility;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.MediaFileRepository;
import com.aetherblog.blog.repository.MediaFolderRepository;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.blog.service.FolderService;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 文件夹服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 1: 文件夹层级管理
 * @author AI Assistant
 * @since 2.1.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FolderServiceImpl implements FolderService {

    private final MediaFolderRepository folderRepository;
    private final MediaFileRepository fileRepository;
    private final UserRepository userRepository;

    private static final Pattern NON_LATIN = Pattern.compile("[^\\w-]");
    private static final Pattern WHITESPACE = Pattern.compile("[\\s]");
    private static final int MAX_DEPTH = 10; // 最大文件夹深度

    @Override
    @Transactional
    @CacheEvict(value = "folderTree", allEntries = true)
    public MediaFolder create(String name, String description, Long parentId, Long userId) {
        Objects.requireNonNull(name, "文件夹名称不能为空");

        // 验证父文件夹
        MediaFolder parent = null;
        if (parentId != null) {
            parent = getById(parentId);

            // 检查深度限制
            if (parent.getDepth() >= MAX_DEPTH) {
                throw new BusinessException(400, "文件夹嵌套层级不能超过 " + MAX_DEPTH + " 层");
            }
        }

        // 生成唯一slug
        String slug = generateUniqueSlug(name, parentId);

        // 创建文件夹实体
        MediaFolder folder = new MediaFolder();
        folder.setName(name.trim());
        folder.setSlug(slug);
        folder.setDescription(description);
        folder.setParent(parent);

        // 设置创建者和所有者
        if (userId != null) {
            User user = userRepository.findById(userId).orElse(null);
            folder.setCreatedBy(user);
            folder.setOwner(user);
        }

        // 更新路径和深度
        folder.updatePath();

        // 保存
        MediaFolder saved = folderRepository.save(folder);
        log.info("创建文件夹成功: id={}, name={}, path={}", saved.getId(), saved.getName(), saved.getPath());

        return saved;
    }

    @Override
    @Transactional
    @CacheEvict(value = "folderTree", allEntries = true)
    public MediaFolder update(Long id, String name, String description, String color, String icon, Long userId) {
        Objects.requireNonNull(id, "文件夹ID不能为空");

        MediaFolder folder = getById(id);

        // 更新基本信息
        if (StringUtils.hasText(name) && !name.equals(folder.getName())) {
            folder.setName(name.trim());

            // 如果名称改变，需要重新生成slug并更新路径
            String newSlug = generateUniqueSlug(name, folder.getParent() != null ? folder.getParent().getId() : null);
            folder.setSlug(newSlug);
            folder.updatePath();

            // 递归更新所有子文件夹的路径
            updateChildrenPaths(folder);
        }

        if (description != null) {
            folder.setDescription(description);
        }

        if (StringUtils.hasText(color)) {
            folder.setColor(color);
        }

        if (StringUtils.hasText(icon)) {
            folder.setIcon(icon);
        }

        // 设置更新者
        if (userId != null) {
            User user = userRepository.findById(userId).orElse(null);
            folder.setUpdatedBy(user);
        }

        MediaFolder updated = folderRepository.save(folder);
        log.info("更新文件夹成功: id={}, name={}", updated.getId(), updated.getName());

        return updated;
    }

    @Override
    @Transactional
    @CacheEvict(value = "folderTree", allEntries = true)
    public void delete(Long id) {
        Objects.requireNonNull(id, "文件夹ID不能为空");

        MediaFolder folder = getById(id);

        // 检查是否为根文件夹
        if (folder.isRoot() && "root".equals(folder.getSlug())) {
            throw new BusinessException(400, "不能删除根文件夹");
        }

        // 删除文件夹 (会级联删除子文件夹和关联的文件)
        folderRepository.delete(folder);

        // 更新父文件夹统计
        if (folder.getParent() != null) {
            updateStatisticsRecursive(folder.getParent().getId());
        }

        log.info("删除文件夹成功: id={}, name={}, path={}", id, folder.getName(), folder.getPath());
    }

    @Override
    public MediaFolder getById(Long id) {
        Objects.requireNonNull(id, "文件夹ID不能为空");
        return folderRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文件夹不存在: " + id));
    }

    @Override
    public MediaFolder getByPath(String path) {
        Objects.requireNonNull(path, "文件夹路径不能为空");
        return folderRepository.findByPath(path)
                .orElseThrow(() -> new BusinessException(404, "文件夹不存在: " + path));
    }

    @Override
    @Cacheable(value = "folderTree", key = "'all'")
    public List<MediaFolder> getTree() {
        List<MediaFolder> allFolders = folderRepository.findFolderTree();
        return buildTree(allFolders);
    }

    @Override
    @Cacheable(value = "folderTree", key = "#userId")
    public List<MediaFolder> getTreeByUserId(Long userId) {
        Objects.requireNonNull(userId, "用户ID不能为空");
        List<MediaFolder> allFolders = folderRepository.findFolderTreeByUserId(userId);
        return buildTree(allFolders);
    }

    @Override
    public List<MediaFolder> getChildren(Long parentId) {
        if (parentId == null) {
            return folderRepository.findByParentIsNullOrderBySortOrderAsc();
        }
        return folderRepository.findByParentIdOrderBySortOrderAsc(parentId);
    }

    @Override
    @Transactional
    @CacheEvict(value = "folderTree", allEntries = true)
    public MediaFolder move(Long folderId, Long newParentId, Long userId) {
        Objects.requireNonNull(folderId, "文件夹ID不能为空");

        MediaFolder folder = getById(folderId);

        // 检查是否为根文件夹
        if (folder.isRoot() && "root".equals(folder.getSlug())) {
            throw new BusinessException(400, "不能移动根文件夹");
        }

        // 验证新父文件夹
        MediaFolder newParent = null;
        if (newParentId != null) {
            newParent = getById(newParentId);

            // 检查是否移动到自己或自己的子文件夹
            if (newParentId.equals(folderId)) {
                throw new BusinessException(400, "不能将文件夹移动到自己");
            }

            if (newParent.getPath().startsWith(folder.getPath() + "/")) {
                throw new BusinessException(400, "不能将文件夹移动到自己的子文件夹");
            }

            // 检查深度限制
            int newDepth = newParent.getDepth() + 1;
            int currentSubtreeDepth = calculateSubtreeDepth(folder);
            if (newDepth + currentSubtreeDepth > MAX_DEPTH) {
                throw new BusinessException(400, "移动后文件夹嵌套层级将超过 " + MAX_DEPTH + " 层");
            }
        }

        // 保存旧父文件夹ID用于更新统计
        Long oldParentId = folder.getParent() != null ? folder.getParent().getId() : null;

        // 更新父文件夹
        folder.setParent(newParent);
        folder.updatePath();

        // 设置更新者
        if (userId != null) {
            User user = userRepository.findById(userId).orElse(null);
            folder.setUpdatedBy(user);
        }

        // 递归更新所有子文件夹的路径
        updateChildrenPaths(folder);

        MediaFolder moved = folderRepository.save(folder);

        // 更新旧父文件夹和新父文件夹的统计
        if (oldParentId != null) {
            updateStatisticsRecursive(oldParentId);
        }
        if (newParentId != null) {
            updateStatisticsRecursive(newParentId);
        }

        log.info("移动文件夹成功: id={}, from={}, to={}", folderId, oldParentId, newParentId);

        return moved;
    }

    @Override
    @Transactional
    public void updateStatistics(Long folderId) {
        Objects.requireNonNull(folderId, "文件夹ID不能为空");

        MediaFolder folder = getById(folderId);

        // 统计直接子文件
        List<MediaFile> files = fileRepository.findByFolderId(folderId);
        int fileCount = files.size();
        long totalSize = files.stream().mapToLong(MediaFile::getFileSize).sum();

        // 统计子文件夹
        List<MediaFolder> children = folderRepository.findByParentIdOrderBySortOrderAsc(folderId);
        for (MediaFolder child : children) {
            fileCount += child.getFileCount();
            totalSize += child.getTotalSize();
        }

        folder.setFileCount(fileCount);
        folder.setTotalSize(totalSize);
        folderRepository.save(folder);

        log.debug("更新文件夹统计: id={}, fileCount={}, totalSize={}", folderId, fileCount, totalSize);
    }

    @Override
    @Transactional
    public void updateStatisticsRecursive(Long folderId) {
        if (folderId == null) {
            return;
        }

        updateStatistics(folderId);

        MediaFolder folder = getById(folderId);
        if (folder.getParent() != null) {
            updateStatisticsRecursive(folder.getParent().getId());
        }
    }

    @Override
    public boolean hasAccess(Long folderId, Long userId) {
        if (folderId == null || userId == null) {
            return false;
        }

        MediaFolder folder = getById(folderId);

        // 公开文件夹所有人可访问
        if (folder.getVisibility() == Visibility.PUBLIC) {
            return true;
        }

        // 所有者可访问
        if (folder.getOwner() != null && folder.getOwner().getId().equals(userId)) {
            return true;
        }

        // TODO: 实现团队权限检查 (Phase 5)
        if (folder.getVisibility() == Visibility.TEAM) {
            // 暂时返回false，等待Phase 5实现
            return false;
        }

        return false;
    }

    @Override
    public String generateUniqueSlug(String name, Long parentId) {
        String baseSlug = slugify(name);
        String slug = baseSlug;
        int counter = 1;

        // 检查slug是否唯一
        boolean exists;
        if (parentId == null) {
            exists = folderRepository.existsBySlugAndParentIsNull(slug);
        } else {
            exists = folderRepository.existsBySlugAndParentId(slug, parentId);
        }

        // 如果不唯一，添加数字后缀
        while (exists) {
            slug = baseSlug + "-" + counter;
            counter++;

            if (parentId == null) {
                exists = folderRepository.existsBySlugAndParentIsNull(slug);
            } else {
                exists = folderRepository.existsBySlugAndParentId(slug, parentId);
            }
        }

        return slug;
    }

    /**
     * 将字符串转换为URL友好的slug
     */
    private String slugify(String input) {
        if (input == null || input.isEmpty()) {
            return "folder";
        }

        String noWhitespace = WHITESPACE.matcher(input).replaceAll("-");
        String normalized = Normalizer.normalize(noWhitespace, Normalizer.Form.NFD);
        String slug = NON_LATIN.matcher(normalized).replaceAll("");
        slug = slug.toLowerCase(Locale.ENGLISH);
        slug = slug.replaceAll("-+", "-");
        slug = slug.replaceAll("^-|-$", "");

        return slug.isEmpty() ? "folder" : slug;
    }

    /**
     * 递归更新子文件夹的路径
     */
    private void updateChildrenPaths(MediaFolder folder) {
        List<MediaFolder> children = folderRepository.findByParentIdOrderBySortOrderAsc(folder.getId());
        for (MediaFolder child : children) {
            child.updatePath();
            folderRepository.save(child);
            updateChildrenPaths(child);
        }
    }

    /**
     * 计算文件夹子树的最大深度
     */
    private int calculateSubtreeDepth(MediaFolder folder) {
        List<MediaFolder> children = folderRepository.findByParentIdOrderBySortOrderAsc(folder.getId());
        if (children.isEmpty()) {
            return 0;
        }

        int maxChildDepth = 0;
        for (MediaFolder child : children) {
            int childDepth = calculateSubtreeDepth(child);
            maxChildDepth = Math.max(maxChildDepth, childDepth);
        }

        return maxChildDepth + 1;
    }

    /**
     * 将扁平的文件夹列表构建为树形结构
     *
     * @param allFolders 所有文件夹的扁平列表
     * @return 根级别的文件夹列表，每个文件夹包含其完整的子树
     */
    private List<MediaFolder> buildTree(List<MediaFolder> allFolders) {
        if (allFolders == null || allFolders.isEmpty()) {
            return new ArrayList<>();
        }

        // 创建ID到文件夹的映射
        Map<Long, MediaFolder> folderMap = allFolders.stream()
                .collect(Collectors.toMap(MediaFolder::getId, folder -> folder));

        // 按父ID分组
        Map<Long, List<MediaFolder>> childrenByParentId = allFolders.stream()
                .filter(folder -> folder.getParent() != null)
                .collect(Collectors.groupingBy(folder -> folder.getParent().getId()));

        // 为每个文件夹设置其子文件夹
        for (MediaFolder folder : allFolders) {
            List<MediaFolder> children = childrenByParentId.getOrDefault(folder.getId(), new ArrayList<>());
            // 按sortOrder排序
            children.sort(Comparator.comparing(MediaFolder::getSortOrder));
            folder.setChildren(children);
        }

        // 返回根级别的文件夹（parent为null的文件夹）
        return allFolders.stream()
                .filter(folder -> folder.getParent() == null)
                .sorted(Comparator.comparing(MediaFolder::getSortOrder))
                .collect(Collectors.toList());
    }
}
