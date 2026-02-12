package com.aetherblog.common.core.utils;

import jakarta.servlet.http.HttpServletRequest;

/**
 * IP工具类
 */
public class IpUtils {

    private static final String UNKNOWN = "unknown";
    private static final String LOCALHOST_IPV4 = "127.0.0.1";
    private static final String LOCALHOST_IPV6 = "0:0:0:0:0:0:0:1";

    private IpUtils() {}

    /**
     * 获取客户端IP地址
     */
    public static String getIpAddr(HttpServletRequest request) {
        if (request == null) {
            return UNKNOWN;
        }

        // Security Fix: Prioritize X-Real-IP (set by trusted Nginx) to prevent IP spoofing
        // Users can manipulate X-Forwarded-For, but X-Real-IP is overwritten by Nginx
        String ip = request.getHeader("X-Real-IP");

        if (isUnknown(ip)) {
            ip = request.getHeader("x-forwarded-for");
        }
        if (isUnknown(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (isUnknown(ip)) {
            ip = request.getHeader("X-Forwarded-For");
        }
        if (isUnknown(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }
        if (isUnknown(ip)) {
            ip = request.getRemoteAddr();
        }

        // Security Fix: Take the LAST IP from comma-separated list to prevent spoofing.
        // The first IP is client-controlled; the last is added by the closest trusted proxy.
        if (ip != null && ip.contains(",")) {
            String[] ips = ip.split(",");
            ip = ips[ips.length - 1].trim();
        }

        // 转换本地IPv6为IPv4
        if (LOCALHOST_IPV6.equals(ip)) {
            ip = LOCALHOST_IPV4;
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
