package com.aetherblog.common.core.utils;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.when;

/**
 * @ref Issue #259 - 验证 IpUtils 受信任代理校验逻辑
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class IpUtilsTest {

    @Mock
    private HttpServletRequest request;

    @Test
    void shouldReadProxyHeadersWhenFromTrustedProxy() {
        // 来自 localhost（受信任代理），应读取 X-Real-IP
        when(request.getRemoteAddr()).thenReturn("127.0.0.1");
        when(request.getHeader("X-Real-IP")).thenReturn("203.0.113.50");

        String ip = IpUtils.getIpAddr(request);
        assertEquals("203.0.113.50", ip, "来自受信任代理时，应读取 X-Real-IP");
    }

    @Test
    void shouldReadProxyHeadersFromDockerNetwork() {
        // 来自 Docker 网络 172.17.x.x（受信任代理）
        when(request.getRemoteAddr()).thenReturn("172.17.0.1");
        when(request.getHeader("X-Real-IP")).thenReturn("8.8.8.8");

        String ip = IpUtils.getIpAddr(request);
        assertEquals("8.8.8.8", ip, "来自 Docker 网络时，应读取 X-Real-IP");
    }

    @Test
    void shouldIgnoreProxyHeadersWhenDirectConnection() {
        // 直连客户端（非受信任代理），应忽略代理头
        when(request.getRemoteAddr()).thenReturn("203.0.113.99");
        when(request.getHeader("X-Real-IP")).thenReturn("1.1.1.1");
        when(request.getHeader("X-Forwarded-For")).thenReturn("6.6.6.6");

        String ip = IpUtils.getIpAddr(request);
        assertEquals("203.0.113.99", ip, "直连客户端时，应忽略所有可伪造的代理头");
    }

    @Test
    void shouldPreventIpSpoofingViaHeaders() {
        // 攻击者直连并伪造代理头试图绕过限流
        when(request.getRemoteAddr()).thenReturn("198.51.100.1");
        when(request.getHeader("X-Real-IP")).thenReturn("10.0.0.1");  // 伪造成内网 IP
        when(request.getHeader("X-Forwarded-For")).thenReturn("192.168.1.1, 10.0.0.1");

        String ip = IpUtils.getIpAddr(request);
        assertEquals("198.51.100.1", ip, "应忽略非信任来源的伪造代理头");
    }

    @Test
    void shouldFallbackToXForwardedForWhenXRealIpMissing() {
        // 来自受信任代理但 X-Real-IP 缺失
        when(request.getRemoteAddr()).thenReturn("127.0.0.1");
        when(request.getHeader("X-Real-IP")).thenReturn(null);
        when(request.getHeader("X-Forwarded-For")).thenReturn("1.2.3.4");

        String ip = IpUtils.getIpAddr(request);
        assertEquals("1.2.3.4", ip, "X-Real-IP 缺失时应回退到 X-Forwarded-For");
    }

    @Test
    void shouldTakeLastIpFromForwardedChain() {
        // 来自受信任代理，X-Forwarded-For 含多个 IP
        when(request.getRemoteAddr()).thenReturn("127.0.0.1");
        when(request.getHeader("X-Real-IP")).thenReturn(null);
        when(request.getHeader("X-Forwarded-For")).thenReturn("6.6.6.6, 192.168.1.100");

        String ip = IpUtils.getIpAddr(request);
        assertEquals("192.168.1.100", ip, "应取最后一个 IP（最近可信代理追加的）");
    }

    @Test
    void shouldConvertIpv6LoopbackToIpv4() {
        when(request.getRemoteAddr()).thenReturn("0:0:0:0:0:0:0:1");
        when(request.getHeader("X-Real-IP")).thenReturn(null);
        when(request.getHeader("X-Forwarded-For")).thenReturn(null);
        when(request.getHeader("x-forwarded-for")).thenReturn(null);
        when(request.getHeader("Proxy-Client-IP")).thenReturn(null);
        when(request.getHeader("WL-Proxy-Client-IP")).thenReturn(null);

        String ip = IpUtils.getIpAddr(request);
        assertEquals("127.0.0.1", ip, "IPv6 loopback 应转换为 IPv4");
    }

    @Test
    void shouldReturnRemoteAddrWhenNoProxyHeaders() {
        // 来自受信任代理但所有代理头都为空
        when(request.getRemoteAddr()).thenReturn("192.168.1.10");
        when(request.getHeader("X-Real-IP")).thenReturn(null);
        when(request.getHeader("X-Forwarded-For")).thenReturn(null);
        when(request.getHeader("x-forwarded-for")).thenReturn(null);
        when(request.getHeader("Proxy-Client-IP")).thenReturn(null);
        when(request.getHeader("WL-Proxy-Client-IP")).thenReturn(null);

        String ip = IpUtils.getIpAddr(request);
        assertEquals("192.168.1.10", ip, "所有代理头缺失时应回退到 remoteAddr");
    }
}
