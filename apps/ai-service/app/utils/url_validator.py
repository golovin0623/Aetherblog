"""SSRF protection: validate that URLs do not resolve to private/internal networks.

History:
- Initial implementation (FINDING-011) covered IPv4 + IPv6 basics.
- VULN-058: strengthened to reject IPv4-mapped IPv6 (``::ffff:127.0.0.1``) and
  broadcast addresses. Documented DNS-rebinding as a residual risk requiring
  network-layer controls.
- VULN-076: added an async variant (``validate_external_url_async``) that calls
  ``asyncio.get_running_loop().getaddrinfo`` to avoid blocking the event loop
  inside the AI service's async request path.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
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
    ipaddress.ip_network('255.255.255.255/32'),  # broadcast
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fd00::/8'),
    ipaddress.ip_network('fe80::/10'),
]


def is_ip_blocked(ip: IPAddress) -> bool:
    """Check if an IP address is blocked.

    SECURITY (VULN-058): IPv4-mapped IPv6 (``::ffff:127.0.0.1``) must be
    downgraded to the underlying IPv4 and re-checked, otherwise attackers can
    bypass the IPv4 blocklist by prefixing with ``::ffff:``.
    """
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return is_ip_blocked(ip.ipv4_mapped)
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        return True
    return any(ip in network for network in BLOCKED_NETWORKS)


def validate_external_url(url: str) -> bool:
    """Synchronous URL validation — use ``validate_external_url_async`` from
    async code paths (VULN-076). This sync version remains for
    ``RemoteModelFetcher`` and tooling where blocking is acceptable.
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
    """Async variant of ``validate_external_url`` for use inside FastAPI /
    asyncio request paths. Avoids blocking the event loop on DNS (VULN-076).

    Note: this is still one-shot resolve + use. DNS rebinding (VULN-058 TOCTOU)
    is mitigated primarily by the network layer — treat this as one line of
    defense, not the only one.
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
