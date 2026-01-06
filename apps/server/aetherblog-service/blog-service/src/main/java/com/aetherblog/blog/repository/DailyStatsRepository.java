package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.DailyStats;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface DailyStatsRepository extends JpaRepository<DailyStats, Long> {

    Optional<DailyStats> findByStatDate(LocalDate statDate);

    List<DailyStats> findByStatDateBetweenOrderByStatDateAsc(LocalDate startDate, LocalDate endDate);

    @Query("SELECT d FROM DailyStats d ORDER BY d.statDate DESC")
    List<DailyStats> findRecentStats(Pageable pageable);

    @Query("SELECT SUM(d.pv) FROM DailyStats d WHERE d.statDate BETWEEN :startDate AND :endDate")
    Long sumPvBetween(@Param("startDate") LocalDate startDate, @Param("endDate") LocalDate endDate);

    @Query("SELECT SUM(d.uv) FROM DailyStats d WHERE d.statDate BETWEEN :startDate AND :endDate")
    Long sumUvBetween(@Param("startDate") LocalDate startDate, @Param("endDate") LocalDate endDate);
}
