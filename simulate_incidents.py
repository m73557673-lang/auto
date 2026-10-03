"""Script to simulate multiple active microservice incidents with realistic telemetry."""

from __future__ import annotations

import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.database import Database

db = Database(Path("backend/data/incidents.sqlite3"))
db.initialize()

now = datetime.datetime.now(datetime.timezone.utc).isoformat()

services_data = [
    {
        "id": "inc-auth-9021",
        "title": "OAuth 2.0 Token Verification Failures",
        "service": "Authentication Service",
        "severity": "critical",
        "summary": "Auth service returning HTTP 500 on token introspect due to Redis session cache timeout",
        "http_status": 500,
        "latency": 3200.0,
        "error_details": "Redis connection pool timeout during session lookup",
        "events": [
            ("opened", "Incident opened after 3 failed token validation health checks."),
            ("failure_observed", "Redis cluster node failover in progress; elevated latency observed."),
        ],
    },
    {
        "id": "inc-pay-81720",
        "title": "Payment Provider Upstream 504 Timeout",
        "service": "Payment Gateway",
        "severity": "critical",
        "summary": "Upstream credit card processor gateway timeout >5000ms",
        "http_status": 504,
        "latency": 5400.0,
        "error_details": "HTTP 504 Gateway Timeout from external acquiring bank",
        "events": [
            ("opened", "Payment processing health probes exceeding 5000ms threshold."),
            ("failure_observed", "High rate of checkout drop-offs detected on credit card transactions."),
        ],
    },
    {
        "id": "inc-srch-38190",
        "title": "Search Elasticsearch Cluster High Memory & Latency",
        "service": "Catalog Search API",
        "severity": "high",
        "summary": "Catalog query latency degraded to 2800ms due to unoptimized wildcard aggregations",
        "http_status": 503,
        "latency": 2850.0,
        "error_details": "CircuitBreakerException: Data too large, JVM heap at 98.4%",
        "events": [
            ("opened", "Elasticsearch JVM heap memory usage spiked above 95%."),
            ("failure_observed", "Search requests queued; fallback search indexing triggered."),
        ],
    },
    {
        "id": "inc-notif-55310",
        "title": "Notification Service Email Delivery Failures",
        "service": "Notification Service",
        "severity": "high",
        "summary": "SMTP relay rejecting outbound email with 550 auth error; 40% delivery failure rate",
        "http_status": 500,
        "latency": 1200.0,
        "error_details": "SMTPAuthenticationError: 550 5.7.1 Unauthenticated email not accepted from this domain",
        "events": [
            ("opened", "Notification service health check failing due to SMTP relay errors."),
            ("failure_observed", "Order confirmation and password reset emails failing to deliver."),
        ],
    },
    {
        "id": "inc-cdn-77441",
        "title": "CDN Edge Cache Purge Propagation Failure",
        "service": "Content Delivery Network",
        "severity": "high",
        "summary": "CDN cache invalidation stuck; users receiving stale product images and CSS assets",
        "http_status": 502,
        "latency": 890.0,
        "error_details": "502 Bad Gateway from CDN origin shield; cache-control bypass failing",
        "events": [
            ("opened", "CDN health probe returning 502 from edge nodes in EU-WEST-1 region."),
            ("failure_observed", "Stale asset serving confirmed via cache-hit headers on purged resources."),
            ("failure_observed", "Cache purge API returned 202 Accepted but propagation incomplete after 10 minutes."),
        ],
    },
    {
        "id": "inc-inv-22918",
        "title": "Inventory Service DB Primary Replica Lag",
        "service": "Inventory Management",
        "severity": "high",
        "summary": "PostgreSQL read replica lag exceeded 45 seconds causing stale stock counts and overselling",
        "http_status": 500,
        "latency": 6100.0,
        "error_details": "PostgreSQL replica lag: 47.3s; read queries timing out on replica node",
        "events": [
            ("opened", "Inventory health check timed out; DB replica unreachable from application pod."),
            ("failure_observed", "Overselling of limited-stock items detected due to stale replica reads."),
        ],
    },
    {
        "id": "inc-api-10394",
        "title": "API Gateway Rate Limiter Misconfiguration",
        "service": "API Gateway",
        "severity": "critical",
        "summary": "API gateway applying global 100 req/min limit to all tenants instead of per-tenant policy",
        "http_status": 429,
        "latency": 45.0,
        "error_details": "HTTP 429 Too Many Requests; X-RateLimit-Policy: global (expected per-tenant)",
        "events": [
            ("opened", "API gateway health probe returning 429 after config deploy at 14:20 UTC."),
            ("failure_observed", "Enterprise tenant SLA breach: less than 2% of allowed requests succeeding."),
            ("failure_observed", "Rollback initiated but rate-limit config not refreshed on all pods."),
        ],
    },
]

added = 0
with db.connection() as conn:
    for item in services_data:
        existing = conn.execute("SELECT id FROM incidents WHERE id = ?", (item["id"],)).fetchone()
        if not existing:
            conn.execute(
                """INSERT INTO incidents
                (id, title, summary, service, severity, status, first_detected, last_observed, last_http_status, last_response_time_ms, error_details)
                VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)""",
                (item["id"], item["title"], item["summary"], item["service"], item["severity"],
                 now, now, item["http_status"], item["latency"], item["error_details"]),
            )
            for ev_type, ev_sum in item["events"]:
                conn.execute(
                    """INSERT INTO incident_events
                    (incident_id, event_type, observed_at, summary, http_status, response_time_ms, error_details)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (item["id"], ev_type, now, ev_sum, item["http_status"], item["latency"], item["error_details"]),
                )
            conn.execute(
                """INSERT INTO monitor_checks
                (service, incident_id, observed_at, healthy, http_status, response_time_ms, failure_kind, error_details)
                VALUES (?, ?, ?, 0, ?, ?, 'http_failure', ?)""",
                (item["service"], item["id"], now, item["http_status"], item["latency"], item["error_details"]),
            )
            conn.execute(
                """INSERT INTO monitor_state (service, consecutive_failures, last_status, active_incident_id)
                VALUES (?, 3, 'failing', ?)
                ON CONFLICT(service) DO UPDATE SET consecutive_failures=3, last_status='failing', active_incident_id=excluded.active_incident_id""",
                (item["service"], item["id"]),
            )
            added += 1
            print(f"  + Created: [{item['severity'].upper()}] {item['title']} ({item['service']})")
        else:
            print(f"  ~ Skipped (already exists): {item['id']}")

print(f"\nDone! {added} new incidents added.")
