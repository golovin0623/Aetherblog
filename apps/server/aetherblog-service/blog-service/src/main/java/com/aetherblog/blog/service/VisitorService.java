package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.VisitRecord;
import com.aetherblog.blog.entity.VisitRecord.DeviceType;
import com.aetherblog.blog.entity.VisitDailyStat;
import com.aetherblog.blog.repository.VisitRecordRepository;
import com.aetherblog.blog.repository.VisitDailyStatRepository;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

/**
 * 访客统计服务
 * 
 * @description 处理访问记录、独立访客识别、爬虫过滤等
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VisitorService {

    private final VisitRecordRepository visitRecordRepository;
    private final VisitDailyStatRepository visitDailyStatRepository;

    // 已知爬虫关键词
    private static final Set<String> BOT_KEYWORDS = Set.of(
        "bot", "spider", "crawler", "googlebot", "bingbot", "baiduspider",
        "yandex", "duckduckbot", "slurp", "ia_archiver", "facebookexternalhit",
        "twitterbot", "linkedinbot", "embedly", "quora link preview",
        "showyoubot", "outbrain", "pinterest", "applebot", "semrushbot"
    );

    /**
     * 异步记录访问
     */
    @Async
    @Transactional
    public void recordVisitAsync(String ip, String userAgent, String referer, String pagePath, Long postId) {
        try {
            recordVisit(ip, userAgent, referer, pagePath, postId);
        } catch (Exception e) {
            log.error("Failed to record visit asynchronously", e);
        }
    }

    /**
     * 同步记录访问
     */
    @Transactional
    public VisitRecord recordVisit(String ip, String userAgent, String referer, String pagePath, Long postId) {
        // 检测是否为爬虫
        boolean isBot = detectBot(userAgent);

        // 生成访客哈希（IP前三段 + UA + 日期）
        String visitorHash = generateVisitorHash(ip, userAgent);

        // 解析设备类型
        DeviceType deviceType = parseDeviceType(userAgent);

        // 解析浏览器和操作系统
        String browser = parseBrowser(userAgent);
        String os = parseOS(userAgent);

        VisitRecord record = new VisitRecord();
        record.setVisitorHash(visitorHash);
        record.setIp(maskIp(ip));
        record.setUserAgent(truncate(userAgent, 500));
        record.setPageUrl(pagePath);
        record.setReferer(truncate(referer, 500));
        record.setIsBot(isBot);
        record.setDeviceType(deviceType);
        record.setBrowser(browser);
        record.setOs(os);

        // 暂不解析地理位置（需要 GeoIP 服务）
        // record.setCountry(...);
        // record.setCity(...);

        return visitRecordRepository.save(record);
    }

    /**
     * 获取访客趋势数据
     */
    public List<VisitDailyStat> getVisitorTrend(int days) {
        LocalDate startDate = LocalDate.now().minusDays(days - 1);
        return visitDailyStatRepository.findRecentStats(startDate);
    }

    /**
     * 获取今日统计
     */
    public Map<String, Long> getTodayStats() {
        LocalDateTime todayStart = LocalDate.now().atStartOfDay();
        long pv = visitRecordRepository.countByCreatedAtAfter(todayStart);
        long uv = visitRecordRepository.countDistinctVisitorByCreatedAtAfter(todayStart);
        return Map.of("pv", pv, "uv", uv);
    }

    /**
     * 获取总访客数（所有时间）
     */
    public long getTotalVisitors() {
        return visitRecordRepository.countDistinctVisitorByCreatedAtAfter(
            LocalDateTime.of(2020, 1, 1, 0, 0)
        );
    }

    /**
     * 获取总浏览量
     */
    public long getTotalViews() {
        return visitRecordRepository.count();
    }

    // ========== 私有方法 ==========

    /**
     * 获取真实 IP（处理反向代理）
     */
    private String getRealIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        // 处理多个代理的情况，取第一个
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }
        return ip;
    }

    /**
     * IP 脱敏（192.168.1.100 -> 192.168.1.*）
     */
    private String maskIp(String ip) {
        if (ip == null) return null;
        // IPv4
        if (ip.matches("\\d+\\.\\d+\\.\\d+\\.\\d+")) {
            return ip.replaceAll("\\.\\d+$", ".*");
        }
        // IPv6 简化处理
        return ip.length() > 20 ? ip.substring(0, 20) + "..." : ip;
    }

    /**
     * 生成访客哈希
     */
    private String generateVisitorHash(String ip, String userAgent) {
        String maskedIp = maskIp(ip);
        String date = LocalDate.now().toString();
        String raw = maskedIp + "|" + (userAgent != null ? userAgent : "") + "|" + date;
        
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (Exception e) {
            return String.valueOf(raw.hashCode());
        }
    }

    /**
     * 检测是否为爬虫
     */
    private boolean detectBot(String userAgent) {
        if (userAgent == null || userAgent.isEmpty()) {
            return true; // 无 UA 视为机器人
        }
        String ua = userAgent.toLowerCase();
        return BOT_KEYWORDS.stream().anyMatch(ua::contains);
    }

    /**
     * 解析设备类型
     */
    private DeviceType parseDeviceType(String userAgent) {
        if (userAgent == null) return DeviceType.OTHER;
        String ua = userAgent.toLowerCase();
        if (ua.contains("mobile") || ua.contains("android") || ua.contains("iphone")) {
            return DeviceType.MOBILE;
        }
        if (ua.contains("tablet") || ua.contains("ipad")) {
            return DeviceType.TABLET;
        }
        if (ua.contains("windows") || ua.contains("macintosh") || ua.contains("linux")) {
            return DeviceType.DESKTOP;
        }
        return DeviceType.OTHER;
    }

    /**
     * 解析浏览器
     */
    private String parseBrowser(String userAgent) {
        if (userAgent == null) return "Unknown";
        String ua = userAgent.toLowerCase();
        if (ua.contains("edg")) return "Edge";
        if (ua.contains("chrome")) return "Chrome";
        if (ua.contains("firefox")) return "Firefox";
        if (ua.contains("safari")) return "Safari";
        if (ua.contains("opera") || ua.contains("opr")) return "Opera";
        return "Other";
    }

    /**
     * 解析操作系统
     */
    private String parseOS(String userAgent) {
        if (userAgent == null) return "Unknown";
        String ua = userAgent.toLowerCase();
        if (ua.contains("windows")) return "Windows";
        if (ua.contains("mac os") || ua.contains("macintosh")) return "macOS";
        if (ua.contains("linux")) return "Linux";
        if (ua.contains("android")) return "Android";
        if (ua.contains("iphone") || ua.contains("ipad")) return "iOS";
        return "Other";
    }

    /**
     * 截断字符串
     */
    private String truncate(String str, int maxLen) {
        if (str == null) return null;
        return str.length() > maxLen ? str.substring(0, maxLen) : str;
    }
}
