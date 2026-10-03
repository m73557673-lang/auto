from __future__ import annotations

from dataclasses import replace

from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app


def make_client(tmp_path, **overrides):
    settings = replace(
        Settings(
            database_path=tmp_path / "ai.sqlite3",
            monitor_target_url="http://127.0.0.1:1/health",
            service_name="checkout-api",
            monitor_enabled=False,
            poll_interval_seconds=30,
            failure_threshold=1,
            request_timeout_seconds=0.1,
            allow_private_targets=True,
            api_token="test-secret",
            cors_origins=("http://localhost:5173",),
        ),
        **overrides,
    )
    return TestClient(create_app(settings))


def seed_incident(client):
    response = client.post(
        "/api/monitoring/events",
        json={
            "service": "checkout-api",
            "observedAt": "2026-10-03T10:00:00+00:00",
            "kind": "http_failure",
            "statusCode": 503,
            "responseTimeMs": 420,
            "message": "checkout API unavailable",
        },
        headers={"Authorization": "Bearer test-secret"},
    )
    assert response.status_code == 202
    return response.json()["incident"]["id"]


def test_incident_analysis_returns_structured_response_and_persists(tmp_path, monkeypatch):
    with make_client(tmp_path) as client:
        incident_id = seed_incident(client)

        def fake_generate_analysis(service, incident_id, incident, checks, events):
            return {
                "incidentId": incident_id,
                "summary": "Checkout API is returning 503s after repeated failed health checks.",
                "observed_symptoms": ["HTTP 503 responses"],
                "supporting_evidence": ["Health check at 2026-10-03T10:00:00+00:00: failed; HTTP 503, 420 ms."],
                "possible_root_causes": ["Upstream dependency outage is the leading hypothesis."],
                "potential_impact": "Transactions may fail for end-users while the dependency remains unhealthy.",
                "recommended_steps": ["Check the upstream dependency status and restart the checkout workers."],
                "timeline": ["10:00 UTC - health check began failing"],
                "missing_information": ["Dependency traces from the upstream API."],
                "confidence": "Tentative; one check is available.",
            }

        monkeypatch.setattr(
            "backend.ai_service.GeminiAnalysisService.generate_incident_analysis",
            staticmethod(fake_generate_analysis),
        )

        response = client.post(f"/api/incidents/{incident_id}/analysis", headers={"Authorization": "Bearer test-secret"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["summary"].startswith("Checkout API")
        assert payload["summary"] == "Checkout API is returning 503s after repeated failed health checks."
        assert payload["incidentId"] == incident_id
        assert client.get(f"/api/incidents/{incident_id}/analysis").json()["summary"] == payload["summary"]

    with make_client(tmp_path) as restarted_client:
        persisted = restarted_client.get(f"/api/incidents/{incident_id}/analysis")
        assert persisted.status_code == 200
        assert persisted.json()["summary"] == "Checkout API is returning 503s after repeated failed health checks."


def test_incident_analysis_unknown_incident_is_404(tmp_path):
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/incidents/unknown-analysis/analysis",
            headers={"Authorization": "Bearer test-secret"},
        )
        assert response.status_code == 404


def test_chatbot_uses_incident_context_and_conversation_history(tmp_path, monkeypatch):
    with make_client(tmp_path) as client:
        incident_id = seed_incident(client)

        def fake_chat(service, incident_id, question, history, **context):
            assert "checkout-api" in context["incident"]["service"]
            assert context["checks"][0]["http_status"] == 503
            if history:
                assert question == "What evidence do you have?"
                assert history[0]["content"] == "What happened?"
            else:
                assert question == "What happened?"
            return {
                "answer": "The checkout API has repeated 503 errors and the service has not recovered yet.",
                "confidence": "The record contains one failed check.",
            }

        monkeypatch.setattr(
            "backend.ai_service.GeminiAnalysisService.generate_chat_reply",
            staticmethod(fake_chat),
        )

        first = client.post(
            f"/api/incidents/{incident_id}/chat",
            json={"message": "What happened?", "conversationId": "thread-a"},
            headers={"Authorization": "Bearer test-secret"},
        )
        assert first.status_code == 200
        assert "503" in first.json()["answer"]

        repeat = client.post(
            f"/api/incidents/{incident_id}/chat",
            json={"message": "What evidence do you have?", "conversationId": "thread-a"},
            headers={"Authorization": "Bearer test-secret"},
        )
        assert repeat.status_code == 200
        history = client.get(f"/api/incidents/{incident_id}/chat?conversationId=thread-a").json()
        assert len(history) >= 2
        assert client.get(f"/api/incidents/{incident_id}/chat?conversationId=thread-b").json() == []


def test_invalid_gemini_payload_is_rejected_for_analysis(tmp_path, monkeypatch):
    with make_client(tmp_path) as client:
        incident_id = seed_incident(client)

        def fake_generate_analysis(service, incident_id, incident, checks, events):
            return {"unexpected": "not a valid incident analysis"}

        monkeypatch.setattr(
            "backend.ai_service.GeminiAnalysisService.generate_incident_analysis",
            staticmethod(fake_generate_analysis),
        )

        response = client.post(f"/api/incidents/{incident_id}/analysis", headers={"Authorization": "Bearer test-secret"})
        assert response.status_code == 502
        assert client.get(f"/api/incidents/{incident_id}/analysis").status_code == 404


def test_gemini_key_fallback_and_exhaustion(tmp_path):
    from backend.ai_service import GeminiProvider

    provider = GeminiProvider({
        "GEMINI_API_KEY": "primary",
        "GEMINI_API_KEY_2": "secondary",
        "GEMINI_API_KEY_3": "tertiary",
        "GEMINI_MODEL": "gemini-2.5-flash",
    })

    class FakeClient:
        def __init__(self, api_key):
            self.api_key = api_key

    def fake_client_factory(api_key):
        return FakeClient(api_key)

    provider._client_factory = staticmethod(fake_client_factory)

    class KeyQuotaError(Exception):
        code = 429
        status = "RESOURCE_EXHAUSTED"
        message = "Per API key quota limit reached"

    def fake_call(client, **kwargs):
        if client.api_key == "primary":
            raise KeyQuotaError()
        if client.api_key == "secondary":
            raise KeyQuotaError()
        return {"summary": "Recovered via tertiary key"}

    provider._call_model = staticmethod(fake_call)
    result = provider.generate_json("prompt")
    assert result["summary"] == "Recovered via tertiary key"

    provider._call_model = staticmethod(lambda client, **kwargs: (_ for _ in ()).throw(KeyQuotaError()))
    try:
        provider.generate_json("prompt")
    except RuntimeError as exc:
        assert "All configured Gemini keys" in str(exc)
    else:
        raise AssertionError("Expected all keys exhausted to fail")


def test_incident_analysis_reports_insufficient_evidence_without_provider_call():
    from backend.ai_service import GeminiAnalysisService

    result = GeminiAnalysisService.generate_incident_analysis(
        {}, "inc-012345abcdef", {"id": "inc-012345abcdef", "title": "Recorded incident"}, [], []
    )

    assert "no related health checks" in result["summary"]
    assert result["supporting_evidence"] == ["Incident record: Recorded incident."]
    assert result["possible_root_causes"] == []
    assert result["confidence"].startswith("Low")


def test_provider_does_not_rotate_on_unrelated_errors_or_expose_credentials():
    from backend.ai_service import GeminiProvider, GeminiProviderError

    provider = GeminiProvider({
        "GEMINI_API_KEY": "test-secret-primary",
        "GEMINI_API_KEY_2": "test-secret-secondary",
    })
    calls = []
    provider._client_factory = lambda api_key: calls.append(api_key) or object()
    provider._call_model = lambda client, **kwargs: (_ for _ in ()).throw(ValueError("invalid request"))

    try:
        provider.generate_json("prompt")
    except GeminiProviderError as exc:
        assert "test-secret" not in str(exc)
    else:
        raise AssertionError("Expected provider failure")
    assert len(calls) == 1


def test_provider_does_not_rotate_on_project_wide_quota_failure():
    from backend.ai_service import GeminiProvider, GeminiProviderError

    provider = GeminiProvider({"GEMINI_API_KEY": "primary", "GEMINI_API_KEY_2": "secondary"})
    calls = []
    provider._client_factory = lambda api_key: calls.append(api_key) or object()

    class ProjectQuotaError(Exception):
        code = 429
        status = "RESOURCE_EXHAUSTED"
        message = "Project-wide requests quota exceeded"

    provider._call_model = lambda client, **kwargs: (_ for _ in ()).throw(ProjectQuotaError())
    try:
        provider.generate_json("prompt")
    except GeminiProviderError as exc:
        assert "quota" in str(exc).lower()
    else:
        raise AssertionError("Expected project quota failure")
    assert calls == ["primary"]


def test_gemini_unavailable_does_not_block_incident_resolution(tmp_path, monkeypatch):
    from backend.ai_service import GeminiProviderError

    with make_client(tmp_path) as client:
        incident_id = seed_incident(client)

        def unavailable(*args, **kwargs):
            raise GeminiProviderError("Gemini is temporarily unavailable. Retry later.")

        monkeypatch.setattr(
            "backend.ai_service.GeminiAnalysisService.generate_incident_analysis",
            staticmethod(unavailable),
        )
        failed_analysis = client.post(
            f"/api/incidents/{incident_id}/analysis",
            headers={"Authorization": "Bearer test-secret"},
        )
        assert failed_analysis.status_code == 503

        recovered = client.post(
            "/api/monitoring/events",
            json={
                "service": "checkout-api",
                "observedAt": "2026-10-03T10:01:00+00:00",
                "kind": "healthy",
                "statusCode": 200,
                "responseTimeMs": 40,
            },
            headers={"Authorization": "Bearer test-secret"},
        )
        assert recovered.status_code == 202
        assert client.get(f"/api/incidents/{incident_id}").json()["status"] == "resolved"


def test_settings_loads_all_gemini_keys_from_environment(monkeypatch, tmp_path):
    from backend.config import Settings

    for name, value in {
        "GEMINI_API_KEY": "primary-test-value",
        "GEMINI_API_KEY_2": "secondary-test-value",
        "GEMINI_API_KEY_3": "tertiary-test-value",
        "DATABASE_PATH": str(tmp_path / "settings.sqlite3"),
    }.items():
        monkeypatch.setenv(name, value)

    settings = Settings.from_env()
    assert settings.gemini_api_keys == ("primary-test-value", "secondary-test-value", "tertiary-test-value")


def test_chat_request_rejects_blank_message_and_invalid_conversation_id(tmp_path):
    with make_client(tmp_path) as client:
        incident_id = seed_incident(client)
        headers = {"Authorization": "Bearer test-secret"}
        assert client.post(f"/api/incidents/{incident_id}/chat", json={"message": "  "}, headers=headers).status_code == 422
        assert client.post(
            f"/api/incidents/{incident_id}/chat",
            json={"message": "Explain", "conversationId": "bad id"},
            headers=headers,
        ).status_code == 422
