"""
Switch to a brand-new incident each time you run this command.
Usage:
    python next_incident.py               # Switches to the next incident in the rotation
    python next_incident.py --auto 5      # Automatically cycles a new incident every 5 seconds
    python next_incident.py --resolve     # Resolves all active incidents
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
import time
import uuid
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent))
from backend.database import Database

INCIDENT_LIBRARY = [
    {
        "service": "Authentication Service",
        "title": "OAuth 2.0 Token Verification Failures",
        "severity": "critical",
        "http_status": 500,
        "latency": 3200.0,
        "error_details": "Redis session cache connection pool exhausted; token validation timing out.",
    },
    {
        "service": "Payment Gateway",
        "title": "Payment Provider Upstream 504 Timeout",
        "severity": "critical",
        "http_status": 504,
        "latency": 5800.0,
        "error_details": "HTTP 504 Gateway Timeout from external acquiring bank processor.",
    },
    {
        "service": "Catalog Search API",
        "title": "Elasticsearch Heap High & Slow Queries",
        "severity": "high",
        "http_status": 503,
        "latency": 2900.0,
        "error_details": "CircuitBreakerException: Data too large, JVM heap at 98.4%. Wildcard queries queuing.",
    },
    {
        "service": "Notification Service",
        "title": "SMTP Relay Authentication Drop",
        "severity": "high",
        "http_status": 500,
        "latency": 1150.0,
        "error_details": "SMTPAuthenticationError: 550 5.7.1 outbound email delivery failing for order alerts.",
    },
    {
        "service": "Inventory Management",
        "title": "PostgreSQL Primary Read Replica Lag",
        "severity": "high",
        "http_status": 500,
        "latency": 6100.0,
        "error_details": "PostgreSQL replica lag: 48.2s. Read queries timing out; overselling protection active.",
    },
    {
        "service": "API Gateway",
        "title": "Rate Limiter Global Policy Misconfiguration",
        "severity": "critical",
        "http_status": 429,
        "latency": 45.0,
        "error_details": "HTTP 429: Rate-limit policy throttled all tenants to 100 req/min due to misapplied global rule.",
    },
    {
        "service": "Content Delivery Network",
        "title": "CDN Edge Shield 502 Bad Gateway",
        "severity": "high",
        "http_status": 502,
        "latency": 870.0,
        "error_details": "Origin shield connection dropped; stale assets served to EU & US regions.",
    },
    {
        "service": "Order Processing Service",
        "title": "Kafka Consumer Group Lag Exceeded Threshold",
        "severity": "critical",
        "http_status": 503,
        "latency": 7400.0,
        "error_details": "Order consumer group partitions rebalancing indefinitely; 1.4M pending checkout jobs.",
    },
    {
        "service": "User Profile Service",
        "title": "Document Store Connection Pool Saturation",
        "severity": "medium",
        "http_status": 500,
        "latency": 4200.0,
        "error_details": "Max connections (250/250) reached on user metadata cluster during marketing blast.",
    },
    {
        "service": "Shipping & Logistics Service",
        "title": "Carrier API Webhook Drop Rate > 60%",
        "severity": "medium",
        "http_status": 502,
        "latency": 3100.0,
        "error_details": "External shipping carrier API returning 502 on tracking webhook ingestion.",
    },
]

STATE_FILE = Path("backend/data/.cycle_state.json")
DB_PATH = Path("backend/data/incidents.sqlite3")


def get_current_index() -> int:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8")).get("index", 0)
        except Exception:
            return 0
    return 0


def set_current_index(idx: int) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"index": idx}), encoding="utf-8")


def trigger_next_incident(db: Database) -> dict:
    idx = get_current_index()
    item = INCIDENT_LIBRARY[idx % len(INCIDENT_LIBRARY)]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    incident_id = f"inc-{uuid.uuid4().hex[:12]}"

    with db.connection() as conn:
        # If this service already has an active incident, mark previous one as resolved
        conn.execute(
            """UPDATE incidents SET status = 'resolved', resolved_at = ?
            WHERE service = ? AND status = 'active'""",
            (now, item["service"]),
        )

        # Insert new active incident
        conn.execute(
            """INSERT INTO incidents
            (id, title, summary, service, severity, status, first_detected, last_observed, last_http_status, last_response_time_ms, error_details)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)""",
            (incident_id, item["title"], item["error_details"], item["service"],
             item["severity"], now, now, item["http_status"], item["latency"], item["error_details"]),
        )

        # Record events
        conn.execute(
            """INSERT INTO incident_events
            (incident_id, event_type, observed_at, summary, http_status, response_time_ms, error_details)
            VALUES (?, 'opened', ?, ?, ?, ?, ?)""",
            (incident_id, now,
             f"Incident detected: {item['title']} on {item['service']}.",
             item["http_status"], item["latency"], item["error_details"]),
        )
        conn.execute(
            """INSERT INTO incident_events
            (incident_id, event_type, observed_at, summary, http_status, response_time_ms, error_details)
            VALUES (?, 'failure_observed', ?, ?, ?, ?, ?)""",
            (incident_id, now,
             f"Health check probe failed: HTTP {item['http_status']} ({item['latency']}ms)",
             item["http_status"], item["latency"], item["error_details"]),
        )

        # Record monitor check
        conn.execute(
            """INSERT INTO monitor_checks
            (service, incident_id, observed_at, healthy, http_status, response_time_ms, failure_kind, error_details)
            VALUES (?, ?, ?, 0, ?, ?, 'http_failure', ?)""",
            (item["service"], incident_id, now, item["http_status"], item["latency"], item["error_details"]),
        )

        # Update monitor state
        conn.execute(
            """INSERT INTO monitor_state (service, consecutive_failures, last_status, active_incident_id)
            VALUES (?, 3, 'failing', ?)
            ON CONFLICT(service) DO UPDATE SET consecutive_failures=3,
                last_status='failing', active_incident_id=excluded.active_incident_id""",
            (item["service"], incident_id),
        )

    # Advance state counter
    set_current_index(idx + 1)
    next_item = INCIDENT_LIBRARY[(idx + 1) % len(INCIDENT_LIBRARY)]

    print("=" * 64)
    print(f"  [!] [{item['severity'].upper()}] SWITCHED TO NEW INCIDENT ({idx + 1}/{len(INCIDENT_LIBRARY)})")
    print("=" * 64)
    print(f"  Incident ID : {incident_id}")
    print(f"  Service     : {item['service']}")
    print(f"  Title       : {item['title']}")
    print(f"  HTTP Status : {item['http_status']} ({item['latency']}ms)")
    print(f"  Error       : {item['error_details']}")
    print("-" * 64)
    print(f"  >> Next run will trigger: {next_item['service']} ({next_item['title']})")
    print(f"  -> Dashboard: http://localhost:5000/incidents")
    print("=" * 64 + "\n")
    return item


def resolve_all_incidents(db: Database) -> None:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with db.connection() as conn:
        conn.execute(
            "UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE status = 'active'",
            (now,),
        )
        conn.execute(
            "UPDATE monitor_state SET consecutive_failures = 0, last_status = 'healthy', active_incident_id = NULL"
        )
    print("=" * 64)
    print("  [OK] ALL INCIDENTS RESOLVED - System restored to healthy state.")
    print("  -> Dashboard: http://localhost:5000/incidents")
    print("=" * 64 + "\n")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Switch to a new incident on every execution.")
    parser.add_argument("--auto", type=int, nargs="?", const=5, metavar="SECONDS",
                        help="Auto-cycle a new incident every N seconds (default: 5)")
    parser.add_argument("--resolve", action="store_true",
                        help="Resolve all currently active incidents back to healthy")
    args = parser.parse_args()

    db = Database(DB_PATH)
    db.initialize()

    if args.resolve:
        resolve_all_incidents(db)
        return

    if args.auto:
        sec = max(1, args.auto)
        print(f"Auto-cycling new incidents every {sec} seconds (Press Ctrl+C to stop)...\n")
        try:
            while True:
                trigger_next_incident(db)
                time.sleep(sec)
        except KeyboardInterrupt:
            print("\nStopped auto-cycler.")
            return

    # Single execution: switch to next incident immediately
    trigger_next_incident(db)


if __name__ == "__main__":
    main()
