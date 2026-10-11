"""Rotate the hosted demo through new incidents; push the state to deploy it."""

from __future__ import annotations

import argparse
import time

from backend.demo_simulation import set_healthy, trigger_incidents


def show_publish_steps() -> None:
    print("\nCommit and push the updated demo state to publish it:")
    print("  git add backend/demo_state.json backend/demo_snapshot.py")
    print('  git commit -m "demo: rotate incident"')
    print("  git push origin main")


def main() -> None:
    parser = argparse.ArgumentParser(description="Rotate incident data for the hosted client demo.")
    parser.add_argument("--auto", type=int, nargs="?", const=5, metavar="SECONDS", help="Rotate every N seconds (default: 5)")
    parser.add_argument("--resolve", action="store_true", help="Resolve all active demo incidents")
    args = parser.parse_args()

    if args.resolve:
        resolved = set_healthy()
        print(f"Demo is healthy. Resolved {resolved} active incident(s).")
        show_publish_steps()
        return

    if args.auto:
        interval = max(1, args.auto)
        print(f"Rotating the demo every {interval}s. Stop with Ctrl+C, then push the state file.")
        try:
            while True:
                incident = trigger_incidents(1, replace_active=True)[0]
                print(f"[{incident['severity'].upper()}] {incident['title']} — {incident['service']}")
                time.sleep(interval)
        except KeyboardInterrupt:
            pass
        show_publish_steps()
        return

    incident = trigger_incidents(1, replace_active=True)[0]
    print(f"New incident: [{incident['severity'].upper()}] {incident['title']} — {incident['service']}")
    show_publish_steps()


if __name__ == "__main__":
    main()
