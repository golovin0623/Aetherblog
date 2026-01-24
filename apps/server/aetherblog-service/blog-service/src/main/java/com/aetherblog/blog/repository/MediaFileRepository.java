package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaFile.FileType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface MediaFileRepository extends JpaRepository<MediaFile, Long> {

    // ========== 正常文件查询（排除已删除） ==========

    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.fileType = :fileType")
    Page<MediaFile> findByFileType(FileType fileType, Pageable pageable);

    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.uploader.id = :uploaderId")
    Page<MediaFile> findByUploaderId(Long uploaderId, Pageable pageable);

    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.fileType = :fileType AND (LOWER(m.filename) LIKE LOWER(CONCAT('%', :keyword, '%')) OR LOWER(m.originalName) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    Page<MediaFile> findByFileTypeAndKeyword(FileType fileType, String keyword, Pageable pageable);

    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND (LOWER(m.filename) LIKE LOWER(CONCAT('%', :keyword, '%')) OR LOWER(m.originalName) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    Page<MediaFile> searchByKeyword(String keyword, Pageable pageable);

    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false")
    Page<MediaFile> findAllNotDeleted(Pageable pageable);

    @Query("SELECT SUM(m.fileSize) FROM MediaFile m WHERE m.deleted = false")
    Long getTotalStorageUsed();

    @Query("SELECT m.fileType, COUNT(m) FROM MediaFile m WHERE m.deleted = false GROUP BY m.fileType")
    List<Object[]> countByFileType();

    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.fileType = :fileType ORDER BY m.createdAt DESC")
    List<MediaFile> findByFileTypeOrderByCreatedAtDesc(FileType fileType);

    /**
     * 根据文件夹ID查找文件（排除已删除）
     */
    @EntityGraph(attributePaths = {"folder", "uploader"})
    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.folder.id = :folderId")
    List<MediaFile> findByFolderId(Long folderId);

    /**
     * 根据文件夹ID分页查找文件（排除已删除）
     */
    @EntityGraph(attributePaths = {"folder", "uploader"})
    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.folder.id = :folderId")
    Page<MediaFile> findByFolderId(Long folderId, Pageable pageable);

    /**
     * 根据文件夹ID和文件类型查找文件（排除已删除）
     */
    @EntityGraph(attributePaths = {"folder", "uploader"})
    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.folder.id = :folderId AND m.fileType = :fileType")
    Page<MediaFile> findByFolderIdAndFileType(Long folderId, FileType fileType, Pageable pageable);

    /**
     * 根据文件夹ID和关键词查找文件（排除已删除）
     */
    @EntityGraph(attributePaths = {"folder", "uploader"})
    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.folder.id = :folderId AND (LOWER(m.filename) LIKE LOWER(CONCAT('%', :keyword, '%')) OR LOWER(m.originalName) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    Page<MediaFile> findByFolderIdAndKeyword(Long folderId, String keyword, Pageable pageable);

    /**
     * 根据文件夹ID、文件类型和关键词查找文件（排除已删除）
     */
    @EntityGraph(attributePaths = {"folder", "uploader"})
    @Query("SELECT m FROM MediaFile m WHERE m.deleted = false AND m.folder.id = :folderId AND m.fileType = :fileType AND (LOWER(m.filename) LIKE LOWER(CONCAT('%', :keyword, '%')) OR LOWER(m.originalName) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    Page<MediaFile> findByFolderIdAndFileTypeAndKeyword(Long folderId, FileType fileType, String keyword, Pageable pageable);

    // ========== 回收站相关查询 ==========

    /**
     * 获取回收站文件列表
     */
    @EntityGraph(attributePaths = {"folder", "uploader"})
    @Query("SELECT m FROM MediaFile m WHERE m.deleted = true ORDER BY m.deletedAt DESC")
    Page<MediaFile> findAllDeleted(Pageable pageable);

    /**
     * 获取回收站文件数量
     */
    @Query("SELECT COUNT(m) FROM MediaFile m WHERE m.deleted = true")
    long countDeleted();

    /**
     * 查找超过指定时间的已删除文件（用于自动清理）
     */
    @Query("SELECT m FROM MediaFile m WHERE m.deleted = true AND m.deletedAt < :cutoffTime")
    List<MediaFile> findDeletedBefore(LocalDateTime cutoffTime);
}
