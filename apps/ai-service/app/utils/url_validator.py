"""SSRF protection: validate that URLs do not resolve to private/internal networks."""
# ref: FINDING-011 - SSRF via AI Provider Config

from __future__ import annotations

import ipaddress
import logging
import socket
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

BLOCKED_NETWORKS = [
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('169.254.0.0/16'),
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fd00::/8'),
]


def validate_external_url(url: str) -> bool:
    """Validate URL does not point to internal/private networks."""
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False
        resolved_ip = ipaddress.ip_address(socket.gethostbyname(hostname))
        is_blocked = any(resolved_ip in network for network in BLOCKED_NETWORKS)
        if is_blocked:
            logger.warning(f"Blocked request to private network: {hostname} -> {resolved_ip}")
        return not is_blocked
    except (socket.gaierror, ValueError) as e:
        logger.warning(f"URL validation failed for {url}: {e}")
        return False
