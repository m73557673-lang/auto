from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


class Database:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        db_path = self.path
        if str(db_path) != ":memory:":
            try:
                db_path.parent.mkdir(parents=True, exist_ok=True)
            except OSError:
                db_path = Path("/tmp") / db_path.name
                db_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            connection = sqlite3.connect(str(db_path), timeout=10)
        except sqlite3.OperationalError:
            db_path = Path("/tmp") / db_path.name
            db_path.parent.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(str(db_path), timeout=10)

        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS incidents (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    service TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('active', 'resolved')),
                    first_detected TEXT NOT NULL,
                    last_observed TEXT NOT NULL,
                    resolved_at TEXT,
                    last_http_status INTEGER,
                    last_response_time_ms REAL,
                    error_details TEXT NOT NULL DEFAULT ''
                );
                CREATE UNIQUE INDEX IF NOT EXISTS unique_active_incident_per_service
                    ON incidents(service) WHERE status = 'active';
                CREATE TABLE IF NOT EXISTS monitor_checks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service TEXT NOT NULL,
                    incident_id TEXT REFERENCES incidents(id),
                    observed_at TEXT NOT NULL,
                    healthy INTEGER NOT NULL,
                    http_status INTEGER,
                    response_time_ms REAL,
                    failure_kind TEXT,
                    error_details TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS monitor_checks_incident_time
                    ON monitor_checks(incident_id, observed_at);
                CREATE TABLE IF NOT EXISTS incident_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    incident_id TEXT NOT NULL REFERENCES incidents(id),
                    event_type TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    http_status INTEGER,
                    response_time_ms REAL,
                    error_details TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS incident_events_incident_time
                    ON incident_events(incident_id, observed_at);
                CREATE TABLE IF NOT EXISTS monitor_state (
                    service TEXT PRIMARY KEY,
                    consecutive_failures INTEGER NOT NULL DEFAULT 0,
                    last_check_id INTEGER REFERENCES monitor_checks(id),
                    last_status TEXT NOT NULL DEFAULT 'unknown',
                    active_incident_id TEXT REFERENCES incidents(id)
                );
                CREATE TABLE IF NOT EXISTS incident_analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    incident_id TEXT NOT NULL REFERENCES incidents(id),
                    created_at TEXT NOT NULL,
                    model TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'completed',
                    payload TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS incident_analyses_incident_time
                    ON incident_analyses(incident_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS incident_chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    incident_id TEXT NOT NULL REFERENCES incidents(id),
                    conversation_id TEXT NOT NULL DEFAULT 'default',
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS incident_chat_messages_incident_time
                    ON incident_chat_messages(incident_id, conversation_id, created_at);
                """
            )
        if os.getenv("VERCEL") or os.getenv("VERCEL_ENV") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
            self.seed_initial_incidents_if_empty()



    def seed_initial_incidents_if_empty(self) -> None:
        with self.connection() as connection:
            count = connection.execute("SELECT count(*) FROM incidents").fetchone()[0]
            if count > 0:
                return
            now = iso_timestamp(utc_now())
            sample_incidents = [
                (
                    "inc-auth-9021",
                    "OAuth 2.0 Token Verification Failures",
                    "Auth service returning HTTP 500 on token introspect due to Redis session cache timeout",
                    "Authentication Service",
                    "critical",
                    "active",
                    now,
                    now,
                    None,
                    500,
                    3200.0,
                    "Redis connection pool timeout during session lookup",
                ),
                (
                    "inc-pay-81720",
                    "Payment Provider Upstream 504 Timeout",
                    "Upstream credit card processor gateway timeout >5000ms",
                    "Payment Gateway",
                    "critical",
                    "active",
                    now,
                    now,
                    None,
                    504,
                    5400.0,
                    "HTTP 504 Gateway Timeout from external acquiring bank",
                ),
                (
                    "inc-srch-38190",
                    "Search Elasticsearch Cluster High Memory & Latency",
                    "Catalog query latency degraded to 2800ms due to unoptimized wildcard aggregations",
                    "Catalog Search API",
                    "high",
                    "active",
                    now,
                    now,
                    None,
                    503,
                    2850.0,
                    "CircuitBreakerException: Data too large, JVM heap at 98.4%",
                ),
            ]
            connection.executemany(
                """INSERT OR IGNORE INTO incidents
                   (id, title, summary, service, severity, status, first_detected, last_observed, resolved_at, last_http_status, last_response_time_ms, error_details)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                sample_incidents,
            )
            sample_events = [
                ("inc-auth-9021", "opened", now, "Incident opened after 3 failed token validation health checks.", 500, 3200.0, "Redis connection pool timeout"),
                ("inc-auth-9021", "failure_observed", now, "Redis cluster node failover in progress; elevated latency observed.", 500, 3100.0, "Node 10.0.4.12 unresponsive"),
                ("inc-pay-81720", "opened", now, "Payment processing health probes exceeding 5000ms threshold.", 504, 5400.0, "Gateway timeout"),
                ("inc-pay-81720", "failure_observed", now, "High rate of checkout drop-offs detected on credit card transactions.", 504, 5200.0, "Upstream timeout"),
                ("inc-srch-38190", "opened", now, "Elasticsearch JVM heap memory usage spiked above 95%.", 503, 2850.0, "CircuitBreakerException"),
            ]
            connection.executemany(
                """INSERT INTO incident_events
                   (incident_id, event_type, observed_at, summary, http_status, response_time_ms, error_details)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                sample_events,
            )


    def health(self) -> bool:
        with self.connection() as connection:
            connection.execute("SELECT 1").fetchone()
        return True

    def record_check(self, result: dict[str, Any], failure_threshold: int) -> dict[str, Any]:
        observed_at = iso_timestamp(result["observed_at"])
        service = result["service"]
        is_healthy = bool(result["healthy"])
        incident: dict[str, Any] | None = None

        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = connection.execute(
                "SELECT * FROM monitor_state WHERE service = ?", (service,)
            ).fetchone()
            failures = state["consecutive_failures"] if state else 0
            active_id = state["active_incident_id"] if state else None

            check_cursor = connection.execute(
                """INSERT INTO monitor_checks
                   (service, observed_at, healthy, http_status, response_time_ms, failure_kind, error_details)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    service,
                    observed_at,
                    int(is_healthy),
                    result.get("http_status"),
                    result.get("response_time_ms"),
                    result.get("failure_kind"),
                    result.get("error_details", ""),
                ),
            )
            check_id = check_cursor.lastrowid

            if is_healthy:
                failures = 0
                if active_id:
                    connection.execute(
                        """UPDATE incidents SET status = 'resolved', last_observed = ?, resolved_at = ?,
                           last_http_status = ?, last_response_time_ms = ?, error_details = '' WHERE id = ?""",
                        (observed_at, observed_at, result.get("http_status"), result.get("response_time_ms"), active_id),
                    )
                    connection.execute(
                        "UPDATE monitor_checks SET incident_id = ? WHERE id = ?", (active_id, check_id)
                    )
                    connection.execute(
                        """INSERT INTO incident_events
                           (incident_id, event_type, observed_at, summary, http_status, response_time_ms)
                           VALUES (?, 'resolved', ?, 'Target health check recovered; incident resolved.', ?, ?)""",
                        (active_id, observed_at, result.get("http_status"), result.get("response_time_ms")),
                    )
                    incident = connection.execute("SELECT * FROM incidents WHERE id = ?", (active_id,)).fetchone()
                    active_id = None
            else:
                failures += 1
                if failures >= failure_threshold:
                    if active_id is None:
                        active_id = f"inc-{uuid.uuid4().hex[:12]}"
                        severity = "critical" if (result.get("http_status") or 0) >= 500 else "high"
                        title = f"{service} health check failing"
                        summary = result.get("error_details") or f"Health endpoint returned HTTP {result.get('http_status')}."
                        connection.execute(
                            """INSERT INTO incidents
                               (id, title, summary, service, severity, status, first_detected, last_observed,
                                last_http_status, last_response_time_ms, error_details)
                               VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)""",
                            (
                                active_id,
                                title,
                                summary,
                                service,
                                severity,
                                observed_at,
                                observed_at,
                                result.get("http_status"),
                                result.get("response_time_ms"),
                                result.get("error_details", ""),
                            ),
                        )
                        event_type = "opened"
                        event_summary = f"Incident opened after {failures} consecutive failed checks."
                    else:
                        connection.execute(
                            """UPDATE incidents SET last_observed = ?, last_http_status = ?,
                               last_response_time_ms = ?, error_details = ? WHERE id = ?""",
                            (
                                observed_at,
                                result.get("http_status"),
                                result.get("response_time_ms"),
                                result.get("error_details", ""),
                                active_id,
                            ),
                        )
                        event_type = "failure_observed"
                        event_summary = "Another failed health check was observed while the incident remained active."

                    connection.execute(
                        "UPDATE monitor_checks SET incident_id = ? WHERE id = ?", (active_id, check_id)
                    )
                    connection.execute(
                        """INSERT INTO incident_events
                           (incident_id, event_type, observed_at, summary, http_status, response_time_ms, error_details)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (
                            active_id,
                            event_type,
                            observed_at,
                            event_summary,
                            result.get("http_status"),
                            result.get("response_time_ms"),
                            result.get("error_details", ""),
                        ),
                    )
                    incident = connection.execute("SELECT * FROM incidents WHERE id = ?", (active_id,)).fetchone()

            connection.execute(
                """INSERT INTO monitor_state
                   (service, consecutive_failures, last_check_id, last_status, active_incident_id)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(service) DO UPDATE SET consecutive_failures = excluded.consecutive_failures,
                     last_check_id = excluded.last_check_id, last_status = excluded.last_status,
                     active_incident_id = excluded.active_incident_id""",
                (service, failures, check_id, "healthy" if is_healthy else "failing", active_id),
            )

            check = connection.execute("SELECT * FROM monitor_checks WHERE id = ?", (check_id,)).fetchone()
            return {"check": dict(check), "incident": dict(incident) if incident else None, "consecutive_failures": failures}

    def list_incidents(self, status: str, limit: int) -> list[dict[str, Any]]:
        where = "" if status == "all" else "WHERE status = ?"
        params: tuple[Any, ...] = (limit,) if status == "all" else (status, limit)
        with self.connection() as connection:
            rows = connection.execute(
                f"""SELECT incidents.*,
                    (SELECT COUNT(*) FROM incident_events e WHERE e.incident_id = incidents.id) AS event_count
                    FROM incidents {where} ORDER BY first_detected DESC LIMIT ?""",
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def incident_counts(self) -> dict[str, int]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT status, COUNT(*) AS count FROM incidents GROUP BY status"
            ).fetchall()
        counts = {row["status"]: row["count"] for row in rows}
        return {"active": counts.get("active", 0), "resolved": counts.get("resolved", 0)}

    def get_incident(self, incident_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = connection.execute(
                """SELECT incidents.*,
                    (SELECT COUNT(*) FROM incident_events e WHERE e.incident_id = incidents.id) AS event_count
                    FROM incidents WHERE id = ?""",
                (incident_id,),
            ).fetchone()
        return dict(row) if row else None

    def list_events(self, incident_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM incident_events WHERE incident_id = ? ORDER BY observed_at, id",
                (incident_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_logs(self, incident_id: str) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM monitor_checks WHERE incident_id = ? ORDER BY observed_at, id",
                (incident_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def save_incident_analysis(self, incident_id: str, analysis: dict[str, Any], model: str) -> dict[str, Any]:
        created_at = iso_timestamp(utc_now())
        payload = json.dumps(analysis, default=str)
        with self.connection() as connection:
            cursor = connection.execute(
                "INSERT INTO incident_analyses (incident_id, created_at, model, status, payload) VALUES (?, ?, ?, ?, ?)",
                (incident_id, created_at, model, "completed", payload),
            )
        row = {
            "id": cursor.lastrowid,
            "incidentId": incident_id,
            "createdAt": created_at,
            "model": model,
            "status": "completed",
            **analysis,
        }
        return row

    def get_latest_incident_analysis(self, incident_id: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT * FROM incident_analyses WHERE incident_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
                (incident_id,),
            ).fetchone()
        if not row:
            return None
        payload = json.loads(row["payload"])
        payload["id"] = row["id"]
        payload["incidentId"] = incident_id
        payload["createdAt"] = row["created_at"]
        payload["model"] = row["model"]
        payload["status"] = row["status"]
        return payload

    def save_chat_message(self, incident_id: str, role: str, content: str, conversation_id: str = "default") -> dict[str, Any]:
        created_at = iso_timestamp(utc_now())
        with self.connection() as connection:
            cursor = connection.execute(
                "INSERT INTO incident_chat_messages (incident_id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
                (incident_id, conversation_id, role, content, created_at),
            )
        return {
            "id": cursor.lastrowid,
            "incidentId": incident_id,
            "conversationId": conversation_id,
            "role": role,
            "content": content,
            "createdAt": created_at,
        }

    def list_chat_messages(self, incident_id: str, conversation_id: str | None = None) -> list[dict[str, Any]]:
        with self.connection() as connection:
            if conversation_id is None:
                rows = connection.execute(
                    "SELECT * FROM incident_chat_messages WHERE incident_id = ? ORDER BY created_at ASC, id ASC",
                    (incident_id,),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM incident_chat_messages WHERE incident_id = ? AND conversation_id = ? ORDER BY created_at ASC, id ASC",
                    (incident_id, conversation_id),
                ).fetchall()
        return [dict(row) for row in rows]

    def get_monitor_state(self, service: str) -> dict[str, Any] | None:
        with self.connection() as connection:
            row = connection.execute(
                """SELECT monitor_state.*, monitor_checks.observed_at, monitor_checks.healthy,
                    monitor_checks.http_status, monitor_checks.response_time_ms,
                    monitor_checks.failure_kind, monitor_checks.error_details
                    FROM monitor_state LEFT JOIN monitor_checks ON monitor_checks.id = monitor_state.last_check_id
                    WHERE monitor_state.service = ?""",
                (service,),
            ).fetchone()
        return dict(row) if row else None

    def list_services(self) -> list[dict[str, Any]]:
        with self.connection() as connection:
            rows = connection.execute(
                """SELECT monitor_state.service, monitor_state.consecutive_failures, monitor_state.last_status,
                    monitor_state.active_incident_id, monitor_checks.observed_at, monitor_checks.healthy,
                    monitor_checks.http_status, monitor_checks.response_time_ms, monitor_checks.error_details,
                    (SELECT COUNT(*) FROM incidents WHERE incidents.service = monitor_state.service AND status = 'active')
                      AS active_incident_count
                    FROM monitor_state LEFT JOIN monitor_checks ON monitor_checks.id = monitor_state.last_check_id
                    ORDER BY monitor_state.service"""
            ).fetchall()
        return [dict(row) for row in rows]
