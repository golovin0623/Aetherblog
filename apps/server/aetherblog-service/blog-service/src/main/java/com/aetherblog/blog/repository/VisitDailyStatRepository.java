package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.VisitDailyStat;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * 日统计汇总数据访问层
 */
@Repository
public interface VisitDailyStatRepository extends JpaRepository<VisitDailyStat, Long> {

    Optional<VisitDailyStat> findByStatDate(LocalDate statDate);

    /**
     * 获取指定日期范围内的统计数据
     */
    @Query("SELECT v FROM VisitDailyStat v WHERE v.statDate BETWEEN :startDate AND :endDate ORDER BY v.statDate")
    List<VisitDailyStat> findByDateRange(@Param("startDate") LocalDate startDate, @Param("endDate") LocalDate endDate);

    /**
     * 获取最近 N 天的统计数据
     */
    @Query("SELECT v FROM VisitDailyStat v WHERE v.statDate >= :startDate ORDER BY v.statDate")
    List<VisitDailyStat> findRecentStats(@Param("startDate") LocalDate startDate);

    /**
     * 计算日期范围内的总 PV
     */
    @Query("SELECT COALESCE(SUM(v.pv), 0) FROM VisitDailyStat v WHERE v.statDate BETWEEN :startDate AND :endDate")
    Long sumPvByDateRange(@Param("startDate") LocalDate startDate, @Param("endDate") LocalDate endDate);

    /**
     * 计算日期范围内的总 UV
     */
    @Query("SELECT COALESCE(SUM(v.uv), 0) FROM VisitDailyStat v WHERE v.statDate BETWEEN :startDate AND :endDate")
    Long sumUvByDateRange(@Param("startDate") LocalDate startDate, @Param("endDate") LocalDate endDate);
}
