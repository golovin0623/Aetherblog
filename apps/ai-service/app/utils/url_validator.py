"""SSRF protection: validate that URLs do not resolve to private/internal networks."""
# ref: FINDING-011 - SSRF via AI Provider Config

from __future__ import annotations

import ipaddress
import logging
import socket
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

BLOCKED_NETWORKS = [
    ipaddress.ip_network('0.0.0.0/8'),
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('100.64.0.0/10'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('169.254.0.0/16'),
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fd00::/8'),
    ipaddress.ip_network('fe80::/10'),
]


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Check if an IP address is blocked (private, loopback, link-local, reserved, or in blocked networks)."""
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        return True
    return any(ip in network for network in BLOCKED_NETWORKS)


def validate_external_url(url: str) -> bool:
    """Validate URL does not point to internal/private networks."""
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False
        # Use getaddrinfo for both IPv4 and IPv6 resolution
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
