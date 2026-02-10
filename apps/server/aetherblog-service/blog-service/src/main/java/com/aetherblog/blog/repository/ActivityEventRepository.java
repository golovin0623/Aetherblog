package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.ActivityEvent;
import com.aetherblog.blog.entity.ActivityEvent.EventCategory;
import com.aetherblog.blog.entity.ActivityEvent.EventStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 活动事件数据仓库
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §8.2 - 仪表盘最近动态
 */
@Repository
public interface ActivityEventRepository extends JpaRepository<ActivityEvent, Long> {

    /**
     * 获取最近N条活动事件
     */
    List<ActivityEvent> findTopNByOrderByCreatedAtDesc(Pageable pageable);

    /**
     * 按分类查询活动事件
     */
    Page<ActivityEvent> findByEventCategoryOrderByCreatedAtDesc(EventCategory category, Pageable pageable);

    /**
     * 按状态查询活动事件
     */
    Page<ActivityEvent> findByStatusOrderByCreatedAtDesc(EventStatus status, Pageable pageable);

    /**
     * 按分类和状态查询
     */
    Page<ActivityEvent> findByEventCategoryAndStatusOrderByCreatedAtDesc(
            EventCategory category, EventStatus status, Pageable pageable);

    /**
     * 按时间范围查询
     */
    @Query("SELECT a FROM ActivityEvent a WHERE a.createdAt BETWEEN :startTime AND :endTime ORDER BY a.createdAt DESC")
    Page<ActivityEvent> findByDateRange(
            @Param("startTime") LocalDateTime startTime,
            @Param("endTime") LocalDateTime endTime,
            Pageable pageable);

    /**
     * 按用户ID查询
     */
    Page<ActivityEvent> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    /**
     * 按事件类型查询
     */
    List<ActivityEvent> findByEventTypeOrderByCreatedAtDesc(String eventType, Pageable pageable);

    /**
     * 统计指定时间范围内的事件数
     */
    @Query("SELECT COUNT(a) FROM ActivityEvent a WHERE a.createdAt BETWEEN :startTime AND :endTime")
    long countByDateRange(
            @Param("startTime") LocalDateTime startTime,
            @Param("endTime") LocalDateTime endTime);

    /**
     * 查询所有事件（分页 + 排序）
     */
    @Query("SELECT a FROM ActivityEvent a ORDER BY a.createdAt DESC")
    Page<ActivityEvent> findAllOrderByCreatedAtDesc(Pageable pageable);
}
