package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaFile.FileType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface MediaFileRepository extends JpaRepository<MediaFile, Long> {

    Page<MediaFile> findByFileType(FileType fileType, Pageable pageable);

    Page<MediaFile> findByUploaderId(Long uploaderId, Pageable pageable);

    @Query("SELECT m FROM MediaFile m WHERE m.filename LIKE %:keyword% OR m.originalName LIKE %:keyword%")
    Page<MediaFile> searchByKeyword(String keyword, Pageable pageable);

    @Query("SELECT SUM(m.fileSize) FROM MediaFile m")
    Long getTotalStorageUsed();

    @Query("SELECT m.fileType, COUNT(m) FROM MediaFile m GROUP BY m.fileType")
    List<Object[]> countByFileType();

    List<MediaFile> findByFileTypeOrderByCreatedAtDesc(FileType fileType);
}
