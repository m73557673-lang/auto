from __future__ import annotations

import asyncio
import socket
import threading
import time
from dataclasses import replace

import httpx
import pytest

from backend.config import Settings
from backend.database import Database
from backend.monitor import MonitorService, validate_target_url
from backend.test_target import create_server


def settings_for(tmp_path, threshold=2, timeout=0.05):
    return Settings(
        database_path=tmp_path / "incidents.sqlite3",
        monitor_target_url="http://127.0.0.1:1/health",
        service_name="test-target",
        monitor_enabled=False,
        poll_interval_seconds=30,
        failure_threshold=threshold,
        request_timeout_seconds=timeout,
        allow_private_targets=True,
        api_token="test-token",
        cors_origins=("http://localhost:5173",),
    )


def run_check(tmp_path, handler, threshold=2):
    async def execute():
        config = settings_for(tmp_path, threshold)
        db = Database(config.database_path)
        db.initialize()
        service = MonitorService(config, db)

        async def mock_status_requester(target, addresses):
            request = httpx.Request("GET", target)
            return handler(request).status_code

        service._status_requester = mock_status_requester
        return config, db, service

    config, db, service = asyncio.run(execute())
    return config, db, service


def test_healthy_target_records_status_and_latency(tmp_path):
    config, db, service = run_check(tmp_path, lambda request: httpx.Response(200))
    result = asyncio.run(service.check_once())

    assert result["check"]["healthy"] == 1
    assert result["check"]["http_status"] == 200
    assert result["check"]["response_time_ms"] >= 0
    assert db.list_incidents("all", 100) == []


def test_http_500_opens_after_threshold_and_prevents_duplicates(tmp_path):
    responses = iter([httpx.Response(500), httpx.Response(500), httpx.Response(501)])
    _, db, service = run_check(tmp_path, lambda request: next(responses), threshold=2)

    first = asyncio.run(service.check_once())
    second = asyncio.run(service.check_once())
    third = asyncio.run(service.check_once())

    assert first["incident"] is None
    assert second["incident"]["status"] == "active"
    assert second["incident"]["severity"] == "critical"
    assert third["incident"]["id"] == second["incident"]["id"]
    assert third["incident"]["last_http_status"] == 501
    assert "HTTP 501" in third["incident"]["error_details"]
    assert len(db.list_incidents("active", 100)) == 1
    assert [event["event_type"] for event in db.list_events(second["incident"]["id"])] == [
        "opened",
        "failure_observed",
    ]


def test_connection_refused_is_recorded(tmp_path):
    config = replace(settings_for(tmp_path, threshold=1), request_timeout_seconds=0.5)
    config = replace(config, monitor_target_url="http://127.0.0.1:1/health")
    db = Database(config.database_path)
    db.initialize()
    service = MonitorService(config, db)

    result = asyncio.run(service.check_once())

    assert result["check"]["healthy"] == 0
    assert result["check"]["failure_kind"] == "connection_failure"
    assert result["incident"]["status"] == "active"


def test_timeout_is_recorded(tmp_path):
    def timeout_handler(request):
        raise httpx.ReadTimeout("target did not respond", request=request)

    _, _, service = run_check(tmp_path, timeout_handler, threshold=1)
    result = asyncio.run(service.check_once())

    assert result["check"]["failure_kind"] == "timeout"
    assert "timed out" in result["check"]["error_details"]


def test_timeout_budget_includes_dns_resolution(tmp_path, monkeypatch):
    config, _, service = run_check(tmp_path, lambda request: httpx.Response(200))
    service.settings = replace(
        config,
        monitor_target_url="https://public.example/health",
        allow_private_targets=False,
        request_timeout_seconds=0.01,
    )

    def slow_public_resolution(*args, **kwargs):
        time.sleep(0.05)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]

    monkeypatch.setattr("backend.monitor.socket.getaddrinfo", slow_public_resolution)
    result = asyncio.run(service.check_once())

    assert result["check"]["failure_kind"] == "timeout"
    assert "TimeoutError" in result["check"]["error_details"]


def test_hostname_connection_uses_only_validated_dns_answers(tmp_path, monkeypatch):
    server, _ = create_server(port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    resolutions = []

    def pinned_loopback_resolution(host, port, **kwargs):
        resolutions.append((host, port))
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", port))]

    monkeypatch.setattr("backend.monitor.socket.getaddrinfo", pinned_loopback_resolution)
    try:
        config = replace(
            settings_for(tmp_path),
            monitor_target_url=f"http://pinned.example:{server.server_port}/health",
            request_timeout_seconds=1,
        )
        db = Database(config.database_path)
        db.initialize()
        result = asyncio.run(MonitorService(config, db).check_once())

        assert result["check"]["healthy"] == 1
        assert resolutions == [("pinned.example", server.server_port)]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_dns_answers_containing_non_public_addresses_are_rejected(monkeypatch):
    def mixed_public_resolution(*args, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 80)),
        ]

    monkeypatch.setattr("backend.monitor.socket.getaddrinfo", mixed_public_resolution)

    async def validate():
        with pytest.raises(ValueError, match="non-public IP"):
            await validate_target_url("http://public.example/health", allow_private=False)

    asyncio.run(validate())


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://user:password@example.com/health",
        "http://@example.com/health",
        "https://example.com/health?token=secret",
        "https://example.com/health#fragment",
        "http://example.com:99999/health",
    ],
)
def test_unsafe_url_shapes_are_rejected(url):
    async def validate():
        with pytest.raises(ValueError):
            await validate_target_url(url, allow_private=True)

    asyncio.run(validate())


def test_invalid_configured_target_port_is_rejected(monkeypatch):
    monkeypatch.setenv("MONITOR_TARGET_URL", "http://example.com:99999/health")

    with pytest.raises(ValueError, match="valid URL and port"):
        Settings.from_env()


def test_recovery_resolves_incident_and_persists(tmp_path):
    responses = iter([httpx.Response(503), httpx.Response(503), httpx.Response(200)])
    _, db, service = run_check(tmp_path, lambda request: next(responses), threshold=2)

    asyncio.run(service.check_once())
    opened = asyncio.run(service.check_once())["incident"]
    resolved = asyncio.run(service.check_once())["incident"]

    assert opened["status"] == "active"
    assert resolved["status"] == "resolved"
    assert resolved["resolved_at"] is not None
    assert [event["event_type"] for event in db.list_events(opened["id"])] == ["opened", "resolved"]
    reopened_database = Database(tmp_path / "incidents.sqlite3")
    assert reopened_database.get_incident(opened["id"])["status"] == "resolved"
    persisted_logs = reopened_database.list_logs(opened["id"])
    assert len(persisted_logs) == 2
    assert [log["http_status"] for log in persisted_logs] == [503, 200]


def test_loopback_test_target_failure_and_recovery(tmp_path):
    server, state = create_server(port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        config = replace(
            settings_for(tmp_path, threshold=1),
            monitor_target_url=f"http://127.0.0.1:{server.server_port}/health",
            request_timeout_seconds=0.2,
        )
        db = Database(config.database_path)
        db.initialize()
        service = MonitorService(config, db)

        assert asyncio.run(service.check_once())["check"]["healthy"] == 1
        state.set_mode("failure")
        opened = asyncio.run(service.check_once())["incident"]
        state.set_mode("healthy")
        resolved = asyncio.run(service.check_once())["incident"]

        assert opened["status"] == "active"
        assert resolved["status"] == "resolved"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_slow_loopback_target_times_out(tmp_path):
    server, state = create_server(port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        state.set_mode("timeout")
        config = replace(
            settings_for(tmp_path, threshold=1),
            monitor_target_url=f"http://127.0.0.1:{server.server_port}/health",
            request_timeout_seconds=0.1,
        )
        db = Database(config.database_path)
        db.initialize()
        result = asyncio.run(MonitorService(config, db).check_once())

        assert result["check"]["failure_kind"] == "timeout"
        assert result["check"]["response_time_ms"] < 500
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_real_redirect_response_is_not_followed(tmp_path):
    server, state = create_server(port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        state.set_mode("redirect")
        config = replace(
            settings_for(tmp_path, threshold=1),
            monitor_target_url=f"http://127.0.0.1:{server.server_port}/health",
            request_timeout_seconds=1,
        )
        db = Database(config.database_path)
        db.initialize()
        result = asyncio.run(MonitorService(config, db).check_once())

        assert result["check"]["http_status"] == 302
        assert result["check"]["failure_kind"] == "http_failure"
        assert state.redirect_requests == 0
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_private_and_non_http_targets_are_rejected():
    async def validate():
        with pytest.raises(ValueError, match="non-public IP"):
            await validate_target_url("http://127.0.0.1/health", allow_private=False)
        with pytest.raises(ValueError, match="absolute"):
            await validate_target_url("file:///etc/passwd", allow_private=True)

    asyncio.run(validate())