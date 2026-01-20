package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.MediaFolder;
import com.aetherblog.blog.entity.MediaFolder.Visibility;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 媒体文件夹仓储接口
 *
 * @ref 媒体库深度优化方案 - Phase 1: 文件夹层级管理
 * @author AI Assistant
 * @since 2.1.0
 */
@Repository
public interface MediaFolderRepository extends JpaRepository<MediaFolder, Long> {

    /**
     * 根据slug查找文件夹
     */
    Optional<MediaFolder> findBySlug(String slug);

    /**
     * 根据路径查找文件夹
     */
    Optional<MediaFolder> findByPath(String path);

    /**
     * 查找父文件夹的所有子文件夹
     * Phase 6: 使用 @EntityGraph 避免 N+1 查询问题
     */
    @EntityGraph(attributePaths = {"parent", "owner", "createdBy"})
    List<MediaFolder> findByParentIdOrderBySortOrderAsc(Long parentId);

    /**
     * 查找根文件夹 (parent_id为null)
     * Phase 6: 使用 @EntityGraph 避免 N+1 查询问题
     */
    @EntityGraph(attributePaths = {"owner", "createdBy"})
    List<MediaFolder> findByParentIsNullOrderBySortOrderAsc();

    /**
     * 根据所有者查找文件夹
     */
    List<MediaFolder> findByOwnerIdOrderByCreatedAtDesc(Long ownerId);

    /**
     * 根据可见性查找文件夹
     */
    List<MediaFolder> findByVisibilityOrderByCreatedAtDesc(Visibility visibility);

    /**
     * 查找所有者的根文件夹
     */
    List<MediaFolder> findByOwnerIdAndParentIsNullOrderBySortOrderAsc(Long ownerId);

    /**
     * 根据路径前缀查找所有子孙文件夹 (用于批量操作)
     */
    @Query("SELECT f FROM MediaFolder f WHERE f.path LIKE CONCAT(:pathPrefix, '%') ORDER BY f.path")
    List<MediaFolder> findByPathStartingWith(@Param("pathPrefix") String pathPrefix);

    /**
     * 统计父文件夹下的子文件夹数量
     */
    long countByParentId(Long parentId);

    /**
     * 检查slug在同一父文件夹下是否唯一
     */
    boolean existsBySlugAndParentId(String slug, Long parentId);

    /**
     * 检查slug在根目录下是否唯一 (parent_id为null)
     */
    boolean existsBySlugAndParentIsNull(String slug);

    /**
     * 获取文件夹树 (使用简单的查询，由应用层构建树结构)
     * 避免使用递归CTE和native query导致的实体映射问题
     */
    @Query("SELECT f FROM MediaFolder f ORDER BY f.path, f.sortOrder")
    List<MediaFolder> findFolderTree();

    /**
     * 获取指定用户可见的文件夹树
     */
    @Query("SELECT f FROM MediaFolder f WHERE f.owner.id = :userId OR f.visibility IN ('TEAM', 'PUBLIC') ORDER BY f.path, f.sortOrder")
    List<MediaFolder> findFolderTreeByUserId(@Param("userId") Long userId);

    /**
     * 删除指定路径下的所有文件夹 (级联删除)
     */
    void deleteByPathStartingWith(String pathPrefix);
}
