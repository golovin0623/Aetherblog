package com.aetherblog.common.log.aspect;

import com.aetherblog.common.core.utils.IpUtils;
import com.aetherblog.common.core.utils.JsonUtils;
import com.aetherblog.common.core.utils.ServletUtils;
import com.aetherblog.common.log.annotation.Log;
import com.aetherblog.common.log.domain.OperationLog;
import com.aetherblog.common.log.service.OperationLogService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;

/**
 * 操作日志切面
 */
@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
public class LogAspect {

    private final OperationLogService operationLogService;

    @Around("@annotation(com.aetherblog.common.log.annotation.Log)")
    public Object around(ProceedingJoinPoint point) throws Throwable {
        long startTime = System.currentTimeMillis();
        Object result = null;
        Exception exception = null;

        try {
            result = point.proceed();
            return result;
        } catch (Exception e) {
            exception = e;
            throw e;
        } finally {
            saveLog(point, result, exception, System.currentTimeMillis() - startTime);
        }
    }

    private void saveLog(ProceedingJoinPoint point, Object result, Exception e, long costTime) {
        try {
            MethodSignature signature = (MethodSignature) point.getSignature();
            Method method = signature.getMethod();
            Log logAnnotation = method.getAnnotation(Log.class);

            OperationLog operationLog = new OperationLog();
            operationLog.setModule(logAnnotation.module());
            operationLog.setOperationType(logAnnotation.type().name());
            operationLog.setDescription(logAnnotation.description());
            operationLog.setMethod(point.getTarget().getClass().getName() + "." + method.getName());
            operationLog.setCostTime(costTime);

            HttpServletRequest request = ServletUtils.getRequest();
            if (request != null) {
                operationLog.setRequestUrl(request.getRequestURI());
                operationLog.setRequestMethod(request.getMethod());
                operationLog.setIp(IpUtils.getIpAddr(request));
            }

            if (logAnnotation.saveRequestData()) {
                operationLog.setRequestParams(JsonUtils.toJson(point.getArgs()));
            }

            if (e != null) {
                operationLog.setStatus(1);
                operationLog.setErrorMsg(e.getMessage());
            } else {
                operationLog.setStatus(0);
                if (logAnnotation.saveResponseData() && result != null) {
                    operationLog.setResponseData(JsonUtils.toJson(result));
                }
            }

            operationLogService.save(operationLog);
        } catch (Exception ex) {
            log.error("保存操作日志失败", ex);
        }
    }
}
