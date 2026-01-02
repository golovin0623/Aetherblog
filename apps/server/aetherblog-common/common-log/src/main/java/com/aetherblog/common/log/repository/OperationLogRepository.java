package com.aetherblog.common.log.repository;

import com.aetherblog.common.log.domain.OperationLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;

/**
 * 操作日志仓库
 */
@Repository
public interface OperationLogRepository extends JpaRepository<OperationLog, Long> {

    Page<OperationLog> findByModuleOrderByCreatedAtDesc(String module, Pageable pageable);

    Page<OperationLog> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    void deleteByCreatedAtBefore(LocalDateTime dateTime);
}
