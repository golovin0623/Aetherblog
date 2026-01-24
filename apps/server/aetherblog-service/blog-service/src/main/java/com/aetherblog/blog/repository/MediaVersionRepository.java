package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.MediaVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 媒体版本仓储接口
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Repository
public interface MediaVersionRepository extends JpaRepository<MediaVersion, Long> {

    /**
     * 查找文件的所有版本
     */
    List<MediaVersion> findByMediaFileIdOrderByVersionNumberDesc(Long mediaFileId);

    /**
     * 查找文件的指定版本
     */
    Optional<MediaVersion> findByMediaFileIdAndVersionNumber(Long mediaFileId, Integer versionNumber);

    /**
     * 获取文件的最新版本号
     */
    @Query("SELECT MAX(v.versionNumber) FROM MediaVersion v WHERE v.mediaFile.id = :fileId")
    Optional<Integer> getLatestVersionNumber(@Param("fileId") Long fileId);

    /**
     * 统计文件的版本数量
     */
    long countByMediaFileId(Long mediaFileId);

    /**
     * 删除文件的所有版本
     */
    void deleteByMediaFileId(Long mediaFileId);
}
