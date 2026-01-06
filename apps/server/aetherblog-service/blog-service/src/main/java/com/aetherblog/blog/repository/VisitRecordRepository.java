package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.VisitRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface VisitRecordRepository extends JpaRepository<VisitRecord, Long> {

    Page<VisitRecord> findByPostId(Long postId, Pageable pageable);

    long countByPostId(Long postId);

    @Query("SELECT COUNT(v) FROM VisitRecord v WHERE v.createdAt >= :startTime")
    long countByCreatedAtAfter(@Param("startTime") LocalDateTime startTime);

    @Query("SELECT COUNT(DISTINCT v.visitorId) FROM VisitRecord v WHERE v.createdAt >= :startTime")
    long countDistinctVisitorByCreatedAtAfter(@Param("startTime") LocalDateTime startTime);

    @Query("SELECT v.post.id, COUNT(v) as cnt FROM VisitRecord v WHERE v.post IS NOT NULL GROUP BY v.post.id ORDER BY cnt DESC")
    List<Object[]> findTopVisitedPosts(Pageable pageable);

    @Query("SELECT CAST(v.createdAt AS date), COUNT(v), COUNT(DISTINCT v.visitorId) FROM VisitRecord v WHERE v.createdAt >= :startTime GROUP BY CAST(v.createdAt AS date) ORDER BY CAST(v.createdAt AS date)")
    List<Object[]> getDailyStats(@Param("startTime") LocalDateTime startTime);

    @Query("SELECT v.country, COUNT(v) FROM VisitRecord v WHERE v.country IS NOT NULL GROUP BY v.country ORDER BY COUNT(v) DESC")
    List<Object[]> countByCountry(Pageable pageable);

    @Query("SELECT v.deviceType, COUNT(v) FROM VisitRecord v WHERE v.deviceType IS NOT NULL GROUP BY v.deviceType")
    List<Object[]> countByDeviceType();

    @Query("SELECT v.browser, COUNT(v) FROM VisitRecord v WHERE v.browser IS NOT NULL GROUP BY v.browser ORDER BY COUNT(v) DESC")
    List<Object[]> countByBrowser(Pageable pageable);
}
