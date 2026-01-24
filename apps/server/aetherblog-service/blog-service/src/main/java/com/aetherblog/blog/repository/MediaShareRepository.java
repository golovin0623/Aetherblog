package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.MediaShare;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 媒体分享仓储接口
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Repository
public interface MediaShareRepository extends JpaRepository<MediaShare, Long> {

    /**
     * 根据令牌查找
     */
    Optional<MediaShare> findByShareToken(String shareToken);

    /**
     * 查找文件的所有分享
     */
    List<MediaShare> findByMediaFileId(Long mediaFileId);

    /**
     * 查找文件夹的所有分享
     */
    List<MediaShare> findByFolderId(Long folderId);

    /**
     * 查找用户创建的所有分享
     */
    List<MediaShare> findByCreatedById(Long userId);

    /**
     * 检查令牌是否存在
     */
    boolean existsByShareToken(String shareToken);

    /**
     * 增加访问次数
     */
    @Modifying
    @Query("UPDATE MediaShare s SET s.accessCount = s.accessCount + 1 WHERE s.shareToken = :token")
    void incrementAccessCount(@Param("token") String token);

    /**
     * 删除过期的分享
     */
    @Modifying
    @Query("DELETE FROM MediaShare s WHERE s.expiresAt < CURRENT_TIMESTAMP")
    void deleteExpiredShares();
}
