package com.aetherblog.common.log.domain;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 操作日志实体
 */
@Data
@Entity
@Table(name = "sys_operation_log")
public class OperationLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 操作模块
     */
    @Column(length = 50)
    private String module;

    /**
     * 操作类型
     */
    @Column(length = 20)
    private String operationType;

    /**
     * 操作描述
     */
    @Column(length = 200)
    private String description;

    /**
     * 请求方法
     */
    @Column(length = 200)
    private String method;

    /**
     * 请求URL
     */
    @Column(length = 500)
    private String requestUrl;

    /**
     * 请求方式(GET/POST等)
     */
    @Column(length = 10)
    private String requestMethod;

    /**
     * 请求参数
     */
    @Lob
    @Column(columnDefinition = "TEXT")
    private String requestParams;

    /**
     * 响应数据
     */
    @Lob
    @Column(columnDefinition = "TEXT")
    private String responseData;

    /**
     * 操作状态(0成功 1失败)
     */
    private Integer status;

    /**
     * 错误信息
     */
    @Column(length = 2000)
    private String errorMsg;

    /**
     * 操作用户ID
     */
    private Long userId;

    /**
     * 操作用户名
     */
    @Column(length = 50)
    private String username;

    /**
     * 操作IP
     */
    @Column(length = 50)
    private String ip;

    /**
     * 耗时(毫秒)
     */
    private Long costTime;

    /**
     * 创建时间
     */
    @CreationTimestamp
    private LocalDateTime createdAt;
}
