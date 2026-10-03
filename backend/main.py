from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from backend.ai_service import GeminiAnalysisService, GeminiProviderError, GeminiResponseError
    from backend.config import Settings
    from backend.database import Database, utc_now
    from backend.monitor import CheckResult, MonitorService
    from backend.schemas import (
        IncidentAnalysisRequest,
        IncidentAnalysisResponse,
        IncidentChatMessage,
        IncidentChatRequest,
        IncidentChatResponse,
        MonitoringEventIn,
    )
except ImportError:
    from ai_service import GeminiAnalysisService, GeminiProviderError, GeminiResponseError
    from config import Settings
    from database import Database, utc_now
    from monitor import CheckResult, MonitorService
    from schemas import (
        IncidentAnalysisRequest,
        IncidentAnalysisResponse,
        IncidentChatMessage,
        IncidentChatRequest,
        IncidentChatResponse,
        MonitoringEventIn,
    )



class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now().astimezone().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("request_id", "method", "path", "status_code", "duration_ms", "service", "healthy", "http_status", "response_time_ms", "incident_id"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    if not any(isinstance(existing.formatter, JsonFormatter) for existing in root.handlers):
        root.addHandler(handler)
    root.setLevel(logging.INFO)


def camelize(value: Any) -> Any:
    if isinstance(value, list):
        return [camelize(item) for item in value]
    if isinstance(value, dict):
        converted = {}
        for key, item in value.items():
            parts = key.split("_")
            camel_key = parts[0] + "".join(part.title() for part in parts[1:])
            converted[camel_key] = camelize(item)
        return converted
    return value


def require_token(settings: Settings, authorization: str | None) -> None:
    if not settings.api_token:
        raise HTTPException(status_code=503, detail="Authenticated monitoring endpoints are disabled until COMMANDER_API_TOKEN is configured")
    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not supplied or not secrets.compare_digest(supplied, settings.api_token):
        raise HTTPException(status_code=401, detail="A valid bearer token is required")


def create_app(settings: Settings | None = None) -> FastAPI:
    configure_logging()
    config = settings or Settings.from_env()
    database = Database(config.database_path)
    monitor = MonitorService(config, database)
    logger = logging.getLogger("commander.api")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database.initialize()
        task = None
        if config.monitor_enabled:
            task = asyncio.create_task(monitor.run_forever(), name="health-monitor")
        app.state.monitor_task = task
        yield
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    app = FastAPI(title="AI Incident Commander API", version="0.1.0", lifespan=lifespan)
    app.state.settings = config
    app.state.database = database
    app.state.monitor = monitor
    app.state.manual_check_at = 0.0
    app.state.analysis_locks = {}
    app.state.analysis_locks_guard = threading.Lock()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def request_logging(request: Request, call_next):
        request_id = uuid.uuid4().hex
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled request error", extra={"request_id": request_id, "method": request.method, "path": request.url.path})
            response = JSONResponse(status_code=500, content={"detail": "Internal server error", "requestId": request_id})
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "HTTP request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)

    @app.get("/api/health")
    def health():
        database.health()
        return {"status": "ok", "database": "ok"}

    @app.get("/api/monitoring/status")
    def monitoring_status():
        state = database.get_monitor_state(config.service_name)
        return {
            "enabled": config.monitor_enabled,
            "targetConfigured": config.monitor_target_url is not None,
            "service": config.service_name,
            "intervalSeconds": config.poll_interval_seconds,
            "failureThreshold": config.failure_threshold,
            "consecutiveFailures": state["consecutive_failures"] if state else 0,
            "status": state["last_status"] if state else "unknown",
            "lastCheck": camelize({key: state[key] for key in ("observed_at", "healthy", "http_status", "response_time_ms", "failure_kind", "error_details")}) if state else None,
        }

    @app.post("/api/monitoring/check")
    async def manual_check(authorization: str | None = Header(default=None)):
        require_token(config, authorization)
        now = time.monotonic()
        if now - app.state.manual_check_at < 2:
            raise HTTPException(status_code=429, detail="Manual checks are limited to one every two seconds")
        app.state.manual_check_at = now
        if not config.monitor_target_url:
            raise HTTPException(status_code=409, detail="MONITOR_TARGET_URL is not configured")
        return camelize(await monitor.check_once())

    @app.post("/api/monitoring/events", status_code=status.HTTP_202_ACCEPTED)
    def ingest_event(event: MonitoringEventIn, authorization: str | None = Header(default=None)):
        require_token(config, authorization)
        healthy = event.kind == "healthy"
        result = CheckResult(
            service=event.service,
            observed_at=event.observed_at,
            healthy=healthy,
            http_status=event.status_code,
            response_time_ms=event.response_time_ms,
            failure_kind=None if healthy else event.kind,
            error_details="" if healthy else event.message or event.kind,
        )
        stored = database.record_check(result.as_dict(), config.failure_threshold)
        return camelize({"accepted": True, **stored})

    @app.get("/api/services")
    def services():
        return camelize(database.list_services())

    @app.get("/api/incidents")
    def incidents(
        status_filter: str = Query(default="active", alias="status", pattern="^(active|resolved|all)$"),
        limit: int = Query(default=100, ge=1, le=500),
    ):
        return camelize(database.list_incidents(status_filter, limit))

    @app.get("/api/incidents/summary")
    def incident_summary():
        return database.incident_counts()

    @app.get("/api/incidents/{incident_id}")
    def incident_detail(incident_id: str):
        incident = database.get_incident(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        return camelize(incident)

    @app.get("/api/incidents/{incident_id}/events")
    def incident_events(incident_id: str):
        if not database.get_incident(incident_id):
            raise HTTPException(status_code=404, detail="Incident not found")
        return camelize(database.list_events(incident_id))

    @app.get("/api/incidents/{incident_id}/logs")
    def incident_logs(incident_id: str):
        if not database.get_incident(incident_id):
            raise HTTPException(status_code=404, detail="Incident not found")
        return camelize(database.list_logs(incident_id))

    @app.post("/api/incidents/{incident_id}/analysis")
    def incident_analysis(
        incident_id: str,
        payload: IncidentAnalysisRequest | None = None,
        authorization: str | None = Header(default=None),
    ) -> IncidentAnalysisResponse:
        require_token(config, authorization)
        if not re.fullmatch(r"inc-[a-zA-Z0-9_\-]+", incident_id):
            raise HTTPException(status_code=404, detail="Incident not found")
        incident = database.get_incident(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        with app.state.analysis_locks_guard:
            lock = app.state.analysis_locks.setdefault(incident_id, threading.Lock())
        latest_before_wait = database.get_latest_incident_analysis(incident_id)
        with lock:
            latest = database.get_latest_incident_analysis(incident_id)
            if latest and (not payload or not payload.force):
                return IncidentAnalysisResponse.model_validate(latest)
            if latest and latest_before_wait and latest["id"] != latest_before_wait["id"]:
                return IncidentAnalysisResponse.model_validate(latest)
            checks = database.list_logs(incident_id)
            events = database.list_events(incident_id)
            try:
                analysis = GeminiAnalysisService.generate_incident_analysis(config, incident_id, incident, checks, events)
                validated = IncidentAnalysisResponse.model_validate(analysis)
                saved = database.save_incident_analysis(
                    incident_id,
                    validated.model_dump(exclude={"id", "model", "created_at", "status"}, by_alias=True),
                    config.gemini_model,
                )
                return IncidentAnalysisResponse.model_validate(saved)
            except GeminiProviderError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from None
            except GeminiResponseError:
                raise HTTPException(status_code=502, detail="Gemini returned an invalid analysis response.") from None
            except Exception:
                raise HTTPException(status_code=502, detail="Incident analysis returned an invalid response.") from None

    @app.get("/api/incidents/{incident_id}/analysis")
    def incident_analysis_get(incident_id: str):
        if not re.fullmatch(r"inc-[a-zA-Z0-9_\-]+", incident_id) or not database.get_incident(incident_id):
            raise HTTPException(status_code=404, detail="Incident not found")
        analysis = database.get_latest_incident_analysis(incident_id)
        if not analysis:
            raise HTTPException(status_code=404, detail="Incident analysis not found")
        return IncidentAnalysisResponse.model_validate(analysis)

    @app.post("/api/incidents/{incident_id}/chat")
    def incident_chat(
        incident_id: str,
        payload: IncidentChatRequest,
        authorization: str | None = Header(default=None),
    ) -> IncidentChatResponse:
        require_token(config, authorization)
        if not re.fullmatch(r"inc-[a-zA-Z0-9_\-]+", incident_id):
            raise HTTPException(status_code=404, detail="Incident not found")
        incident = database.get_incident(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        question = payload.message
        conversation_id = payload.conversation_id or uuid.uuid4().hex
        history = database.list_chat_messages(incident_id, conversation_id)
        try:
            generated = GeminiAnalysisService.generate_chat_reply(
                config,
                incident_id,
                question,
                history,
                incident=incident,
                checks=database.list_logs(incident_id),
                events=database.list_events(incident_id),
                analysis=database.get_latest_incident_analysis(incident_id),
            )
            response = IncidentChatResponse.model_validate({
                "incidentId": incident_id,
                "conversationId": conversation_id,
                "answer": generated.get("answer"),
                "confidence": generated.get("confidence") or "Evidence is incomplete; treat interpretation as tentative.",
                "createdAt": utc_now().isoformat(),
            })
        except GeminiProviderError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from None
        except GeminiResponseError:
            raise HTTPException(status_code=502, detail="Gemini returned an invalid chat response.") from None
        except Exception:
            raise HTTPException(status_code=502, detail="Incident chat returned an invalid response.") from None

        database.save_chat_message(incident_id, "user", question, conversation_id)
        database.save_chat_message(incident_id, "assistant", response.answer, conversation_id)
        return response

    @app.get("/api/incidents/{incident_id}/chat")
    def incident_chat_history(
        incident_id: str,
        conversation_id: str | None = Query(default=None, alias="conversationId", max_length=80),
    ) -> list[IncidentChatMessage]:
        if not re.fullmatch(r"inc-[a-zA-Z0-9_\-]+", incident_id) or not database.get_incident(incident_id):
            raise HTTPException(status_code=404, detail="Incident not found")
        if not conversation_id:
            return []
        return [IncidentChatMessage.model_validate(message) for message in database.list_chat_messages(incident_id, conversation_id)]

    return app


app = create_app()