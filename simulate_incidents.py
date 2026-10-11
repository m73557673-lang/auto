"""Write demo telemetry that is deployed from GitHub to the hosted dashboard."""

from __future__ import annotations

import argparse
import sys

from backend.demo_simulation import STATE_PATH, reset, set_healthy, trigger_incidents


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="Prepare demo incident state for the Netlify/Vercel dashboard."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("health", aliases=["healthy"], help="Resolve demo incidents and report healthy checks")
    commands.add_parser("fail", help="Add one simulated service failure")
    trigger = commands.add_parser("trigger", help="Replace active demo incidents with a chosen number")
    trigger.add_argument("count", type=int, help="Number of active incidents (1-10)")
    commands.add_parser("reset", help="Clear demo telemetry")
    args = parser.parse_args()

    if args.command in {"health", "healthy"}:
        resolved = set_healthy()
        print(f"Demo state is healthy. Resolved {resolved} active incident(s).")
    elif args.command == "fail":
        created = trigger_incidents(1)
        print(f"Created one simulated failure: {created[0]['title']} ({created[0]['service']}).")
    elif args.command == "trigger":
        created = trigger_incidents(args.count, replace_active=True)
        print(f"Created {len(created)} active demo incidents:")
        for incident in created:
            print(f"  - [{incident['severity'].upper()}] {incident['title']} — {incident['service']}")
    else:
        reset()
        print("Demo state cleared.")

    print(f"\nUpdated {STATE_PATH.relative_to(STATE_PATH.parents[1])}.")
    print("Commit and push this file to publish the demo state:")
    print("  git add backend/demo_state.json backend/demo_snapshot.py")
    print('  git commit -m "demo: update incident state"')
    print("  git push origin main")


if __name__ == "__main__":
    main()
