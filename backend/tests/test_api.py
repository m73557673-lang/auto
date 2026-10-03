from __future__ import annotations

import asyncio
import threading
from dataclasses import replace
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.test_target import create_server


def make_client(tmp_path, **overrides):
    settings = replace(Settings(
        database_path=tmp_path / "api.sqlite3",
        monitor_target_url="http://127.0.0.1:1/health",
        service_name="api-target",
        monitor_enabled=False,
        poll_interval_seconds=30,
        failure_threshold=1,
        request_timeout_seconds=0.1,
        allow_private_targets=True,
        api_token="test-secret",
        cors_origins=("http://localhost:5173",),
    ), **overrides)
    return TestClient(create_app(settings))


def test_health_and_empty_resources(tmp_path):
    with make_client(tmp_path) as client:
        assert client.get("/api/health").json() == {"status": "ok", "database": "ok"}
        assert client.get("/api/incidents").json() == []
        assert client.get("/api/incidents/summary").json() == {"active": 0, "resolved": 0}
        assert client.get("/api/services").json() == []
        assert client.get("/api/monitoring/status").json()["status"] == "unknown"


def test_authenticated_event_validation_and_incident_queries(tmp_path):
    with make_client(tmp_path) as client:
        payload = {
            "service": "payment-api",
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "kind": "http_failure",
            "statusCode": 503,
            "responseTimeMs": 45.7,
            "message": "upstream unavailable",
        }
        assert client.post("/api/monitoring/events", json=payload).status_code == 401
        invalid = {**payload, "statusCode": 700}
        assert client.post(
            "/api/monitoring/events", json=invalid, headers={"Authorization": "Bearer test-secret"}
        ).status_code == 422
        inconsistent = {**payload, "kind": "healthy"}
        assert client.post(
            "/api/monitoring/events", json=inconsistent, headers={"Authorization": "Bearer test-secret"}
        ).status_code == 422

        accepted = client.post(
            "/api/monitoring/events", json=payload, headers={"Authorization": "Bearer test-secret"}
        )
        assert accepted.status_code == 202
        incident = accepted.json()["incident"]
        assert incident["service"] == "payment-api"
        incident_id = incident["id"]

        assert client.get("/api/incidents").json()[0]["id"] == incident_id
        assert client.get("/api/incidents/summary").json() == {"active": 1, "resolved": 0}
        assert client.get(f"/api/incidents/{incident_id}").json()["status"] == "active"
        assert client.get(f"/api/incidents/{incident_id}/events").json()[0]["eventType"] == "opened"
        assert client.get(f"/api/incidents/{incident_id}/logs").json()[0]["httpStatus"] == 503
        assert client.get("/api/incidents/not-found").status_code == 404

    with make_client(tmp_path) as restarted_client:
        assert restarted_client.get(f"/api/incidents/{incident_id}").json()["status"] == "active"
        assert restarted_client.get(f"/api/incidents/{incident_id}/events").json()[0]["eventType"] == "opened"
        assert restarted_client.get(f"/api/incidents/{incident_id}/logs").json()[0]["httpStatus"] == 503


def test_event_payload_rejects_unknown_fields_and_naive_timestamps(tmp_path):
    with make_client(tmp_path) as client:
        headers = {"Authorization": "Bearer test-secret"}
        payload = {
            "service": "payment-api",
            "observedAt": "2026-10-03T10:00:00",
            "kind": "timeout",
            "message": "timeout",
            "unexpected": True,
        }
        assert client.post("/api/monitoring/events", json=payload, headers=headers).status_code == 422


def test_manual_check_requires_configured_token(tmp_path):
    with make_client(tmp_path) as client:
        assert client.post("/api/monitoring/check").status_code == 401


def test_manual_check_records_real_target_and_api_resolves_incident(tmp_path):
    server, state = create_server(port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with make_client(
            tmp_path,
            monitor_target_url=f"http://127.0.0.1:{server.server_port}/health",
            allow_private_targets=True,
            request_timeout_seconds=0.5,
        ) as client:
            state.set_mode("failure")
            headers = {"Authorization": "Bearer test-secret"}
            result = client.post("/api/monitoring/check", headers=headers)
            assert result.status_code == 200
            incident_id = result.json()["incident"]["id"]
            assert client.get(f"/api/incidents/{incident_id}").json()["status"] == "active"

            state.set_mode("healthy")
            asyncio.run(client.app.state.monitor.check_once())
            assert client.get(f"/api/incidents/{incident_id}").json()["status"] == "resolved"
            assert client.get(f"/api/incidents/{incident_id}/events").json()[-1]["eventType"] == "resolved"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)
