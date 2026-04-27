"""SSRF 防护: 校验 URL 不会解析到私有/内网网段。

历史:
- 初始实现 (FINDING-011) 覆盖 IPv4 + IPv6 基础场景。
- VULN-058: 加固为拒绝 IPv4-mapped IPv6 (``::ffff:127.0.0.1``) 与广播地址。
  把 DNS-rebinding 列为需依赖网络层控制的残留风险。
- VULN-076: 新增 async 版本 (``validate_external_url_async``),
  调用 ``asyncio.get_running_loop().getaddrinfo``,
  避免在 AI 服务的 async 请求路径上阻塞事件循环。
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import socket
from typing import Union
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]

BLOCKED_NETWORKS = [
    ipaddress.ip_network('0.0.0.0/8'),
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('100.64.0.0/10'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('169.254.0.0/16'),
    ipaddress.ip_network('255.255.255.255/32'),  # 广播地址
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fd00::/8'),
    ipaddress.ip_network('fe80::/10'),
]

# 本地开发用的"逃生开关",针对 fake-ip 代理 (Clash/Mihomo 默认
# ``fake-ip-range: 198.18.0.0/16``)。在 fake-ip 模式下,代理 DNS 会回写
# 来自 RFC2544 基准段 (198.18/15) 的合成 IP,标准库会把它们分类为
# ``is_private`` —— 这会让真正的公网主机名被本守卫误伤。
#
# 该开关开启时,放弃宽泛的 ``is_private/is_loopback/is_link_local/is_reserved``
# 启发式,仅依赖上方显式枚举的 BLOCKED_NETWORKS ——
# 该列表依然覆盖所有真实 SSRF 威胁: RFC1918 (10/8, 172.16/12, 192.168/16)、
# 回环 (127/8 + ::1)、link-local 含 AWS/GCP/Azure IMDS (169.254/16)、
# CGNAT (100.64/10)、v6 ULA (fd00::/8)。被**允许**的是
# 198.18/15 (fake-ip)、192.0.2/24 / 198.51.100/24 / 203.0.113/24 (TEST-NET 文档段)、
# 240/4 (class E) —— 这些在实际中都是惰性段,开发环境用是安全的。
#
# 生产环境**必须**保持关闭。启用时启动日志会输出 warning。
_ALLOW_RESERVED = os.environ.get(
    "AETHERBLOG_SSRF_ALLOW_RESERVED", ""
).strip().lower() in ("1", "true", "yes", "on")

if _ALLOW_RESERVED:
    logger.warning(
        "AETHERBLOG_SSRF_ALLOW_RESERVED=1 — SSRF guard running in PERMISSIVE "
        "mode for local development (e.g. behind Clash/Mihomo fake-ip proxy). "
        "RFC2544/TEST-NET/class-E ranges are allowed; RFC1918 + loopback + "
        "IMDS link-local remain blocked. MUST NOT be set in production."
    )


def is_ip_blocked(ip: IPAddress) -> bool:
    """检查给定 IP 是否被屏蔽。

    安全 (VULN-058): IPv4-mapped IPv6 (``::ffff:127.0.0.1``) 必须先降级成
    底层的 IPv4 再重新检查,否则攻击者可以通过加 ``::ffff:`` 前缀绕过 IPv4 黑名单。
    """
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return is_ip_blocked(ip.ipv4_mapped)
    if not _ALLOW_RESERVED and (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    ):
        return True
    return any(ip in network for network in BLOCKED_NETWORKS)


def validate_external_url(url: str) -> bool:
    """同步 URL 校验 —— 在 async 代码路径上请改用 ``validate_external_url_async``
    (VULN-076)。这里的同步版本保留给 ``RemoteModelFetcher`` 以及那些
    阻塞可以接受的工具脚本。
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False
        addr_infos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        if not addr_infos:
            return False
        for addr_info in addr_infos:
            resolved_ip = ipaddress.ip_address(addr_info[4][0])
            if is_ip_blocked(resolved_ip):
                logger.warning(f"Blocked request to private network: {hostname} -> {resolved_ip}")
                return False
        return True
    except (socket.gaierror, ValueError, OSError) as e:
        logger.warning(f"URL validation failed for {url}: {e}")
        return False


async def validate_external_url_async(url: str) -> bool:
    """``validate_external_url`` 的 async 版本,用于 FastAPI /
    asyncio 请求路径。避免在 DNS 解析时阻塞事件循环 (VULN-076)。

    注意: 仍然是"解析一次然后使用"的形态。DNS rebinding (VULN-058 TOCTOU)
    主要靠网络层缓解 —— 把本函数视作一道防线,而不是唯一一道。
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False
        loop = asyncio.get_running_loop()
        addr_infos = await loop.getaddrinfo(
            hostname, None, family=socket.AF_UNSPEC, type=socket.SOCK_STREAM
        )
        if not addr_infos:
            return False
        for addr_info in addr_infos:
            resolved_ip = ipaddress.ip_address(addr_info[4][0])
            if is_ip_blocked(resolved_ip):
                logger.warning(
                    "Blocked async request to private network: %s -> %s",
                    hostname, resolved_ip,
                )
                return False
        return True
    except (socket.gaierror, ValueError, OSError) as e:
        logger.warning("Async URL validation failed for %s: %s", url, e)
        return False
