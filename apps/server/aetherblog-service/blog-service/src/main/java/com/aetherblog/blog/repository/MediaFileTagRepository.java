package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.MediaFileTag;
import com.aetherblog.blog.entity.MediaFileTag.MediaFileTagId;
import com.aetherblog.blog.entity.MediaTag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 媒体文件-标签关联仓储接口
 *
 * @ref 媒体库深度优化方案 - Phase 2: 智能标签系统
 * @author AI Assistant
 * @since 2.2.0
 */
@Repository
public interface MediaFileTagRepository extends JpaRepository<MediaFileTag, MediaFileTagId> {

    /**
     * 查找文件的所有标签
     */
    @Query("SELECT mft.tag FROM MediaFileTag mft WHERE mft.mediaFile.id = :fileId")
    List<MediaTag> findTagsByFileId(@Param("fileId") Long fileId);

    /**
     * 查找带有指定标签的所有文件ID
     */
    @Query("SELECT mft.mediaFile.id FROM MediaFileTag mft WHERE mft.tag.id = :tagId")
    List<Long> findFileIdsByTagId(@Param("tagId") Long tagId);

    /**
     * 删除文件的所有标签
     */
    void deleteByMediaFileId(Long fileId);

    /**
     * 删除文件的指定标签
     */
    void deleteByMediaFileIdAndTagId(Long fileId, Long tagId);

    /**
     * 统计文件的标签数量
     */
    long countByMediaFileId(Long fileId);

    /**
     * 统计标签被使用的次数
     */
    long countByTagId(Long tagId);

    /**
     * 检查文件是否已有该标签
     */
    boolean existsByMediaFileIdAndTagId(Long fileId, Long tagId);
}
