package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.AiUsageLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface AiUsageLogRepository extends JpaRepository<AiUsageLog, Long> {

    @Query("SELECT COALESCE(SUM(CASE WHEN a.totalTokens IS NULL OR a.totalTokens = 0 THEN COALESCE(a.tokensIn, 0) + COALESCE(a.tokensOut, 0) ELSE a.totalTokens END), 0) FROM AiUsageLog a WHERE a.createdAt >= :startTime")
    Long sumTotalTokensByCreatedAtAfter(@Param("startTime") LocalDateTime startTime);

    @Query("SELECT COALESCE(SUM(a.estimatedCost), 0) FROM AiUsageLog a WHERE a.createdAt >= :startTime")
    BigDecimal sumEstimatedCostByCreatedAtAfter(@Param("startTime") LocalDateTime startTime);

    @Query("""
            SELECT COUNT(a),
                   SUM(CASE WHEN a.success = true THEN 1 ELSE 0 END),
                   SUM(CASE WHEN a.success = false THEN 1 ELSE 0 END),
                   COALESCE(SUM(CASE WHEN a.totalTokens IS NULL OR a.totalTokens = 0 THEN COALESCE(a.tokensIn, 0) + COALESCE(a.tokensOut, 0) ELSE a.totalTokens END), 0),
                   COALESCE(SUM(a.estimatedCost), 0),
                   COALESCE(AVG(a.latencyMs), 0),
                   SUM(CASE WHEN a.cached = true THEN 1 ELSE 0 END)
            FROM AiUsageLog a
            WHERE a.createdAt BETWEEN :startTime AND :endTime
            """)
    Object[] aggregateOverview(
            @Param("startTime") LocalDateTime startTime,
            @Param("endTime") LocalDateTime endTime
    );

    @Query("""
            SELECT function('date', a.createdAt),
                   COUNT(a),
                   COALESCE(SUM(CASE WHEN a.totalTokens IS NULL OR a.totalTokens = 0 THEN COALESCE(a.tokensIn, 0) + COALESCE(a.tokensOut, 0) ELSE a.totalTokens END), 0),
                   COALESCE(SUM(a.estimatedCost), 0)
            FROM AiUsageLog a
            WHERE a.createdAt BETWEEN :startTime AND :endTime
            GROUP BY function('date', a.createdAt)
            ORDER BY function('date', a.createdAt)
            """)
    List<Object[]> aggregateDailyTrend(
            @Param("startTime") LocalDateTime startTime,
            @Param("endTime") LocalDateTime endTime
    );

    @Query("""
            SELECT COALESCE(a.modelId, a.model),
                   COALESCE(a.providerCode, ''),
                   COUNT(a),
                   COALESCE(SUM(CASE WHEN a.totalTokens IS NULL OR a.totalTokens = 0 THEN COALESCE(a.tokensIn, 0) + COALESCE(a.tokensOut, 0) ELSE a.totalTokens END), 0),
                   COALESCE(SUM(a.estimatedCost), 0)
            FROM AiUsageLog a
            WHERE a.createdAt BETWEEN :startTime AND :endTime
            GROUP BY COALESCE(a.modelId, a.model), COALESCE(a.providerCode, '')
            ORDER BY COUNT(a) DESC
            """)
    List<Object[]> aggregateModelDistribution(
            @Param("startTime") LocalDateTime startTime,
            @Param("endTime") LocalDateTime endTime
    );

    @Query("""
            SELECT COALESCE(a.taskType, 'unknown'),
                   COUNT(a),
                   COALESCE(SUM(CASE WHEN a.totalTokens IS NULL OR a.totalTokens = 0 THEN COALESCE(a.tokensIn, 0) + COALESCE(a.tokensOut, 0) ELSE a.totalTokens END), 0),
                   COALESCE(SUM(a.estimatedCost), 0)
            FROM AiUsageLog a
            WHERE a.createdAt BETWEEN :startTime AND :endTime
            GROUP BY COALESCE(a.taskType, 'unknown')
            ORDER BY COUNT(a) DESC
            """)
    List<Object[]> aggregateTaskDistribution(
            @Param("startTime") LocalDateTime startTime,
            @Param("endTime") LocalDateTime endTime
    );

    @Query("""
            SELECT a FROM AiUsageLog a
            WHERE a.createdAt BETWEEN :startTime AND :endTime
              AND (:taskType IS NULL OR CAST(COALESCE(a.taskType, '') AS string) = :taskType)
              AND (:modelId IS NULL OR CAST(COALESCE(a.modelId, a.model, '') AS string) = :modelId)
              AND (:success IS NULL OR a.success = :success)
              AND (:keyword IS NULL
                    OR LOWER(CAST(COALESCE(a.modelId, a.model, '') AS string)) LIKE LOWER(CONCAT('%', :keyword, '%'))
                    OR LOWER(CAST(COALESCE(a.providerCode, '') AS string)) LIKE LOWER(CONCAT('%', :keyword, '%'))
                    OR LOWER(CAST(COALESCE(a.taskType, '') AS string)) LIKE LOWER(CONCAT('%', :keyword, '%'))
                    OR LOWER(CAST(COALESCE(a.errorCode, '') AS string)) LIKE LOWER(CONCAT('%', :keyword, '%')))
            ORDER BY a.createdAt DESC
            """)
    Page<AiUsageLog> findRecords(
            @Param("startTime") LocalDateTime startTime,
            @Param("endTime") LocalDateTime endTime,
            @Param("taskType") String taskType,
            @Param("modelId") String modelId,
            @Param("success") Boolean success,
            @Param("keyword") String keyword,
            Pageable pageable
    );
}
