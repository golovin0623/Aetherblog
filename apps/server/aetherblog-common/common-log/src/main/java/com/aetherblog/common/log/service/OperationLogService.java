package com.aetherblog.common.log.service;

import com.aetherblog.common.log.domain.OperationLog;
import com.aetherblog.common.log.repository.OperationLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * 操作日志服务
 */
@Service
@RequiredArgsConstructor
public class OperationLogService {

    private final OperationLogRepository repository;

    /**
     * 异步保存日志
     */
    @Async
    public void save(OperationLog log) {
        repository.save(log);
    }

    /**
     * 分页查询日志
     */
    public Page<OperationLog> findAll(Pageable pageable) {
        return repository.findAll(pageable);
    }

    /**
     * 根据模块查询
     */
    public Page<OperationLog> findByModule(String module, Pageable pageable) {
        return repository.findByModuleOrderByCreatedAtDesc(module, pageable);
    }

    /**
     * 根据用户查询
     */
    public Page<OperationLog> findByUserId(Long userId, Pageable pageable) {
        return repository.findByUserIdOrderByCreatedAtDesc(userId, pageable);
    }

    /**
     * 清理历史日志
     */
    public void cleanBeforeDays(int days) {
        repository.deleteByCreatedAtBefore(java.time.LocalDateTime.now().minusDays(days));
    }
}
