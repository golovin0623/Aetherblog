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

# 永远禁止的网段 —— 即使开了所有"逃生开关"也不能放过。
# 共同特点:在公网 LLM / 自托管 LLM / fake-ip 代理任一场景里都不应出现,
# 一旦命中基本可以确定是 SSRF / 数据外泄路径。
_HARD_BLOCKED_NETWORKS = [
    ipaddress.ip_network('0.0.0.0/8'),                  # "this network",未路由占位
    ipaddress.ip_network('100.64.0.0/10'),              # CGNAT,运营商内部
    ipaddress.ip_network('169.254.0.0/16'),             # AWS/GCP/Azure IMDS + link-local
    ipaddress.ip_network('255.255.255.255/32'),         # IPv4 受限广播
    ipaddress.ip_network('fe80::/10'),                  # IPv6 link-local
]

# RFC1918 + loopback + IPv6 ULA —— 在自托管 LLM 场景 (Ollama / vLLM /
# LM Studio / LiteLLM 自建 proxy / 公司内网 LLM 网关) 里都是合法目标,
# 通过 ``AETHERBLOG_AI_ALLOW_INTERNAL_LLM`` 显式开关放行。
_PRIVATE_LLM_NETWORKS = [
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fd00::/8'),
]

BLOCKED_NETWORKS = _HARD_BLOCKED_NETWORKS + _PRIVATE_LLM_NETWORKS

# 本地开发用的"逃生开关 #1",针对 fake-ip 代理 (Clash/Mihomo 默认
# ``fake-ip-range: 198.18.0.0/16``)。在 fake-ip 模式下,代理 DNS 会回写
# 来自 RFC2544 基准段 (198.18/15) 的合成 IP,标准库会把它们分类为
# ``is_private`` —— 这会让真正的公网主机名被本守卫误伤。
#
# 该开关开启时,放弃宽泛的 ``is_private/is_loopback/is_link_local/is_reserved``
# 启发式,仅依赖 BLOCKED_NETWORKS 显式枚举 —— 它仍覆盖所有真实
# SSRF 威胁。
#
# 生产环境**必须**保持关闭。启用时启动日志会输出 warning。
_ALLOW_RESERVED = os.environ.get(
    "AETHERBLOG_SSRF_ALLOW_RESERVED", ""
).strip().lower() in ("1", "true", "yes", "on")

# 逃生开关 #2 —— 自托管 / 内网 LLM 场景。
#
# 用例:把 provider 的 ``base_url`` 指向本机 Ollama
# (``http://127.0.0.1:11434/v1``)、容器名 (``http://ollama:11434/v1``)、
# 公司内网的 LiteLLM 代理 (``http://10.x.x.x:4000/v1``) 等。这些都是
# 合法目标,但落到默认黑名单的 RFC1918 / loopback / ULA 段。
#
# 启用后:仅放行 ``_PRIVATE_LLM_NETWORKS``。**永远拒绝** ``_HARD_BLOCKED_NETWORKS``
# (尤其是 169.254/16 IMDS,云环境从未是合法的 LLM endpoint —— 一旦
# 命中基本可以判定是被攻陷的 admin 账号在尝试外泄云上元数据)。
#
# 默认 false。开启时启动日志输出 warning,并解释残留风险与适用场景。
_ALLOW_INTERNAL_LLM = os.environ.get(
    "AETHERBLOG_AI_ALLOW_INTERNAL_LLM", ""
).strip().lower() in ("1", "true", "yes", "on")

if _ALLOW_RESERVED:
    logger.warning(
        "AETHERBLOG_SSRF_ALLOW_RESERVED=1 — SSRF guard running in PERMISSIVE "
        "mode for local development (e.g. behind Clash/Mihomo fake-ip proxy). "
        "RFC2544/TEST-NET/class-E ranges are allowed; RFC1918 + loopback + "
        "IMDS link-local remain blocked. MUST NOT be set in production."
    )

if _ALLOW_INTERNAL_LLM:
    logger.warning(
        "AETHERBLOG_AI_ALLOW_INTERNAL_LLM=1 — SSRF guard allows RFC1918 + "
        "loopback + IPv6 ULA so that provider base_url can point to "
        "self-hosted LLMs (Ollama / vLLM / internal LLM gateway). IMDS "
        "(169.254/16) / CGNAT (100.64/10) / 0.0.0.0/8 remain HARD-BLOCKED. "
        "Threat model: this opens up the admin role to internal network "
        "exfiltration if the admin account is compromised — keep admin "
        "credentials safe and deploy ai-service in a network segment that "
        "cannot reach unrelated internal services."
    )


def is_ip_blocked(ip: IPAddress) -> bool:
    """检查给定 IP 是否被屏蔽。

    安全 (VULN-058): IPv4-mapped IPv6 (``::ffff:127.0.0.1``) 必须先降级成
    底层的 IPv4 再重新检查,否则攻击者可以通过加 ``::ffff:`` 前缀绕过 IPv4 黑名单。
    """
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return is_ip_blocked(ip.ipv4_mapped)

    # _HARD_BLOCKED_NETWORKS 永远拒绝 —— 不受任何 escape hatch 影响。
    if any(ip in network for network in _HARD_BLOCKED_NETWORKS):
        return True

    # 自托管 LLM 场景:显式放行 RFC1918 / loopback / ULA。
    in_private_llm = any(ip in network for network in _PRIVATE_LLM_NETWORKS)
    if in_private_llm:
        return not _ALLOW_INTERNAL_LLM

    # 其它"被标准库视为 reserved"的段 (TEST-NET / class-E / fake-ip 等):
    # 仅在 ALLOW_RESERVED 时放行;_ALLOW_INTERNAL_LLM 不暗含 ALLOW_RESERVED,
    # 因为后者用于解决"公网域名被错误归类为 private"的问题,语义不同。
    if not _ALLOW_RESERVED and (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    ):
        return True
    return False


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
