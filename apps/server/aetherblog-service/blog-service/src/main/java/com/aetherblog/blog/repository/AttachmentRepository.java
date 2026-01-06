package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.Attachment;
import com.aetherblog.blog.entity.Attachment.StorageType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 附件数据仓库
 * 
 * @ref §6.1 - 附件表 (V2 新增)
 */
@Repository
public interface AttachmentRepository extends JpaRepository<Attachment, Long> {

    /**
     * 按文章查询附件
     */
    List<Attachment> findByPostIdOrderByCreatedAtDesc(Long postId);

    /**
     * 按上传者查询
     */
    Page<Attachment> findByUploaderId(Long uploaderId, Pageable pageable);

    /**
     * 按存储类型查询
     */
    Page<Attachment> findByStorageType(StorageType storageType, Pageable pageable);

    /**
     * 按原始文件名模糊搜索
     */
    @Query("SELECT a FROM Attachment a WHERE LOWER(a.originalName) LIKE LOWER(CONCAT('%', :keyword, '%')) ORDER BY a.createdAt DESC")
    Page<Attachment> searchByName(@Param("keyword") String keyword, Pageable pageable);

    /**
     * 统计存储空间使用
     */
    @Query("SELECT COALESCE(SUM(a.fileSize), 0) FROM Attachment a")
    Long getTotalStorageUsed();

    /**
     * 按存储类型统计
     */
    @Query("SELECT a.storageType, COUNT(a), COALESCE(SUM(a.fileSize), 0) FROM Attachment a GROUP BY a.storageType")
    List<Object[]> getStorageStatsByType();

    /**
     * 统计下载次数
     */
    @Query("SELECT COALESCE(SUM(a.downloadCount), 0) FROM Attachment a")
    Long getTotalDownloads();

    /**
     * 删除文章关联的附件
     */
    void deleteByPostId(Long postId);
}
