"""Write demo telemetry that is deployed from GitHub to the hosted dashboard."""

from __future__ import annotations

import argparse
import subprocess
import sys

from backend.demo_simulation import STATE_PATH, reset, set_healthy, trigger_incidents


REPO_ROOT = STATE_PATH.parents[1]
PUBLISH_FILES = ("backend/demo_state.json", "backend/demo_snapshot.py")


def publish_demo_state(command: str) -> None:
    """Commit only the generated demo state and push it to the connected deploys."""
    def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
        )
        if check and result.returncode:
            detail = result.stderr.strip() or result.stdout.strip()
            raise RuntimeError(detail or f"git {' '.join(args)} failed.")
        return result

    branch = git("branch", "--show-current").stdout.strip()
    if branch != "main":
        raise RuntimeError(f"You are on branch '{branch or '(detached HEAD)'}'. Switch to main before publishing demo state.")

    git("add", "--", *PUBLISH_FILES)
    changed = git("diff", "--cached", "--quiet", "--", *PUBLISH_FILES, check=False)
    if changed.returncode == 0:
        print("The demo state is unchanged; nothing needs pushing.")
        return
    if changed.returncode != 1:
        raise RuntimeError("Could not check the generated demo-state changes.")

    git("commit", "-m", f"demo: publish {command} state", "--", *PUBLISH_FILES)
    commit = git("rev-parse", "--short", "HEAD").stdout.strip()
    print(f"Committed demo state as {commit}.")
    git("push", "origin", "main")
    print("Pushed to GitHub. Vercel will deploy the backend automatically.")
    print("Refresh the live dashboard after that deployment finishes:")
    print("  https://ai-incident-commander.netlify.app")


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
    try:
        publish_demo_state(args.command)
    except (OSError, RuntimeError) as exc:
        print(f"\nCould not publish automatically: {exc}", file=sys.stderr)
        print("The updated state is still saved locally. Fix the issue and rerun the same command to publish it.", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
