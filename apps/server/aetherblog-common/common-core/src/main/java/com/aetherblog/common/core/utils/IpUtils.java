package com.aetherblog.common.core.utils;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Set;

/**
 * IP工具类
 *
 * <p>安全说明：本工具类仅在请求直接来源于受信任的代理 IP 时，
 * 才读取 {@code X-Real-IP} / {@code X-Forwarded-For} 等代理头。
 * 如果请求直连到服务（非代理来源），则直接使用 {@code request.getRemoteAddr()}，
 * 避免客户端通过伪造请求头绕过 IP 限流等安全机制。</p>
 *
 * @ref Issue #259
 */
public class IpUtils {

    private static final String UNKNOWN = "unknown";
    private static final String LOCALHOST_IPV4 = "127.0.0.1";
    private static final String LOCALHOST_IPV6 = "0:0:0:0:0:0:0:1";

    /**
     * 受信任的代理 IP 列表（本机回环、Docker 默认网关、常见内网网段前缀）。
     * <p>只有当 {@code request.getRemoteAddr()} 属于此集合时，才信任代理头。</p>
     * <p>生产环境中 Nginx 通常与后端在同一机器或 Docker 网络内，
     * 其 remoteAddr 为 {@code 127.0.0.1} 或 {@code 172.x.x.x}。</p>
     */
    private static final Set<String> TRUSTED_PROXIES = Set.of(
            "127.0.0.1",
            "0:0:0:0:0:0:0:1",  // IPv6 loopback
            "::1"               // IPv6 loopback shorthand
    );

    /**
     * Docker / 内网网段前缀，用于前缀匹配。
     */
    private static final String[] TRUSTED_PREFIXES = {
            "10.",       // 10.0.0.0/8
            "172.16.",   // 172.16.0.0/12 (172.16 - 172.31)
            "172.17.",
            "172.18.",
            "172.19.",
            "172.20.",
            "172.21.",
            "172.22.",
            "172.23.",
            "172.24.",
            "172.25.",
            "172.26.",
            "172.27.",
            "172.28.",
            "172.29.",
            "172.30.",
            "172.31.",
            "192.168.", // 192.168.0.0/16
    };

    private IpUtils() {}

    /**
     * 获取客户端IP地址。
     *
     * <p>安全策略：
     * <ol>
     *   <li>检查 {@code request.getRemoteAddr()} 是否为受信任的代理地址</li>
     *   <li>若是：依次检查 {@code X-Real-IP}、{@code X-Forwarded-For} 等代理头</li>
     *   <li>若否：直接返回 {@code getRemoteAddr()}，忽略所有可被伪造的代理头</li>
     * </ol>
     * </p>
     */
    public static String getIpAddr(HttpServletRequest request) {
        if (request == null) {
            return UNKNOWN;
        }

        String remoteAddr = request.getRemoteAddr();

        // 仅当直连来源是受信任的代理时，才读取代理头
        if (!isTrustedProxy(remoteAddr)) {
            // 直连客户端，不信任任何代理头
            return normalizeIp(remoteAddr);
        }

        // 来自受信任代理 —— 读取代理写入的头
        // 优先 X-Real-IP（Nginx proxy_set_header 覆写，不可被客户端伪造）
        String ip = request.getHeader("X-Real-IP");

        if (isUnknown(ip)) {
            ip = request.getHeader("X-Forwarded-For");
        }
        if (isUnknown(ip)) {
            ip = request.getHeader("x-forwarded-for");
        }
        if (isUnknown(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (isUnknown(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }
        if (isUnknown(ip)) {
            ip = remoteAddr;
        }

        // 取逗号分隔中的最后一个 IP（离服务最近的可信代理追加的）
        if (ip != null && ip.contains(",")) {
            String[] ips = ip.split(",");
            ip = ips[ips.length - 1].trim();
        }

        return normalizeIp(ip);
    }

    /**
     * 判断直连地址是否来自受信任的代理。
     */
    private static boolean isTrustedProxy(String remoteAddr) {
        if (remoteAddr == null) {
            return false;
        }
        if (TRUSTED_PROXIES.contains(remoteAddr)) {
            return true;
        }
        for (String prefix : TRUSTED_PREFIXES) {
            if (remoteAddr.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 标准化 IP 地址（IPv6 loopback → IPv4）。
     */
    private static String normalizeIp(String ip) {
        if (LOCALHOST_IPV6.equals(ip) || "::1".equals(ip)) {
            return LOCALHOST_IPV4;
        }
        return ip;
    }

    /**
     * 判断IP是否为内网IP
     */
    public static boolean isInternalIp(String ip) {
        if (LOCALHOST_IPV4.equals(ip) || LOCALHOST_IPV6.equals(ip)) {
            return true;
        }
        byte[] addr = textToNumericFormatV4(ip);
        if (addr == null) {
            return false;
        }
        return internalIp(addr);
    }

    private static boolean isUnknown(String str) {
        return str == null || str.isEmpty() || UNKNOWN.equalsIgnoreCase(str);
    }

    private static boolean internalIp(byte[] addr) {
        final byte b0 = addr[0];
        final byte b1 = addr[1];
        // 10.x.x.x
        if (b0 == (byte) 10) return true;
        // 172.16.x.x - 172.31.x.x
        if (b0 == (byte) 172 && b1 >= (byte) 16 && b1 <= (byte) 31) return true;
        // 192.168.x.x
        return b0 == (byte) 192 && b1 == (byte) 168;
    }

    private static byte[] textToNumericFormatV4(String src) {
        if (src == null || src.isEmpty()) return null;
        String[] parts = src.split("\\.");
        if (parts.length != 4) return null;
        byte[] res = new byte[4];
        try {
            for (int i = 0; i < 4; i++) {
                int val = Integer.parseInt(parts[i]);
                if (val < 0 || val > 255) return null;
                res[i] = (byte) val;
            }
        } catch (NumberFormatException e) {
            return null;
        }
        return res;
    }
}
