from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlsplit

import aiohttp
import httpx
from aiohttp.abc import AbstractResolver, ResolveResult

try:
    from backend.config import Settings
    from backend.database import Database
except ImportError:
    from config import Settings
    from database import Database


logger = logging.getLogger("commander.monitor")


class UnsafeTargetError(ValueError):
    pass


@dataclass(frozen=True)
class CheckResult:
    service: str
    observed_at: datetime
    healthy: bool
    http_status: int | None
    response_time_ms: float | None
    failure_kind: str | None
    error_details: str

    def as_dict(self) -> dict[str, object]:
        return {
            "service": self.service,
            "observed_at": self.observed_at,
            "healthy": self.healthy,
            "http_status": self.http_status,
            "response_time_ms": self.response_time_ms,
            "failure_kind": self.failure_kind,
            "error_details": self.error_details[:2000],
        }


async def validate_target_url(url: str, allow_private: bool) -> list[ResolveResult]:
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise UnsafeTargetError("Target URL is malformed or has an invalid port") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeTargetError("Target must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None or "@" in parsed.netloc or parsed.fragment or parsed.query:
        raise UnsafeTargetError("Target URL cannot contain credentials, a query, or a fragment")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".localhost") or hostname.endswith(".local"):
        if not allow_private:
            raise UnsafeTargetError("Local target hostnames are blocked; enable ALLOW_PRIVATE_TARGETS only for local testing")

    port = port or (443 if parsed.scheme == "https" else 80)
    try:
        literal_ip = ipaddress.ip_address(hostname)
        resolved = [{
            "hostname": hostname,
            "host": str(literal_ip),
            "port": port,
            "family": socket.AF_INET6 if literal_ip.version == 6 else socket.AF_INET,
            "proto": socket.IPPROTO_TCP,
            "flags": socket.AI_NUMERICHOST,
        }]
    except ValueError:
        try:
            answers = await asyncio.to_thread(
                socket.getaddrinfo,
                hostname,
                port,
                type=socket.SOCK_STREAM,
            )
        except OSError as exc:
            raise UnsafeTargetError(f"Target host could not be resolved: {exc}") from exc
        resolved = []
        for family, _, proto, _, sockaddr in answers:
            address = sockaddr[0].split("%", 1)[0]
            resolved.append({
                "hostname": hostname,
                "host": address,
                "port": port,
                "family": family,
                "proto": proto,
                "flags": socket.AI_NUMERICHOST,
            })

    if not resolved:
        raise UnsafeTargetError("Target host did not resolve to an address")
    if not allow_private:
        for answer in resolved:
            ip = ipaddress.ip_address(answer["host"])
            if not ip.is_global:
                raise UnsafeTargetError("Target resolves to a non-public IP address")
    return resolved


class PinnedResolver(AbstractResolver):
    def __init__(self, hostname: str, addresses: list[ResolveResult]):
        self.hostname = hostname.rstrip(".").lower()
        self.addresses = addresses

    async def resolve(self, host: str, port: int = 0, family: int = socket.AF_INET) -> list[ResolveResult]:
        if host.rstrip(".").lower() != self.hostname:
            raise UnsafeTargetError("Unexpected hostname requested by monitor transport")
        return [
            {**address, "hostname": host, "port": port}
            for address in self.addresses
            if family == socket.AF_UNSPEC or address["family"] == family
        ]

    async def close(self) -> None:
        return None


class MonitorService:
    def __init__(self, settings: Settings, database: Database):
        self.settings = settings
        self.database = database
        self._status_requester = self._request_status

    async def _request_status(self, target: str, addresses: list[ResolveResult]) -> int:
        parsed = urlsplit(target)
        resolver = PinnedResolver(parsed.hostname or "", addresses)
        connector = aiohttp.TCPConnector(
            resolver=resolver,
            use_dns_cache=False,
            force_close=True,
        )
        timeout = aiohttp.ClientTimeout(total=self.settings.request_timeout_seconds)
        async with aiohttp.ClientSession(connector=connector, timeout=timeout, trust_env=False) as client:
            async with client.get(
                target,
                allow_redirects=False,
                headers={"User-Agent": "AI-Incident-Commander-Monitor/1.0"},
            ) as response:
                return response.status

    async def check_once(self) -> dict[str, object]:
        target = self.settings.monitor_target_url
        if not target:
            raise RuntimeError("MONITOR_TARGET_URL is not configured")

        observed_at = datetime.now(timezone.utc)
        started = time.perf_counter()
        status: int | None = None
        failure_kind: str | None = None
        error_details = ""
        healthy = False
        try:
            async with asyncio.timeout(self.settings.request_timeout_seconds):
                addresses = await validate_target_url(target, self.settings.allow_private_targets)
                status = await self._status_requester(target, addresses)
                healthy = 200 <= status < 300
                if not healthy:
                    failure_kind = "http_failure"
                    error_details = f"Health endpoint returned HTTP {status}"
        except (aiohttp.ServerTimeoutError, httpx.TimeoutException, TimeoutError) as exc:
            failure_kind = "timeout"
            error_details = f"Health check timed out after {self.settings.request_timeout_seconds:g}s ({type(exc).__name__})"
        except (aiohttp.ClientError, httpx.RequestError, OSError, UnsafeTargetError) as exc:
            failure_kind = "connection_failure" if not isinstance(exc, UnsafeTargetError) else "unsafe_target"
            error_details = str(exc)
        except Exception as exc:
            logger.exception("Unexpected target check error", extra={"service": self.settings.service_name})
            failure_kind = "monitor_error"
            error_details = f"Monitor error ({type(exc).__name__})"

        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        result = CheckResult(
            service=self.settings.service_name,
            observed_at=observed_at,
            healthy=healthy,
            http_status=status,
            response_time_ms=elapsed_ms,
            failure_kind=failure_kind,
            error_details=error_details,
        )
        stored = self.database.record_check(result.as_dict(), self.settings.failure_threshold)
        logger.info(
            "Health check completed",
            extra={
                "service": self.settings.service_name,
                "healthy": healthy,
                "http_status": status,
                "response_time_ms": elapsed_ms,
                "incident_id": (stored["incident"] or {}).get("id"),
            },
        )
        return stored

    async def run_forever(self) -> None:
        while True:
            try:
                await self.check_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Scheduled monitoring cycle failed")
            await asyncio.sleep(self.settings.poll_interval_seconds)
