"""Loopback-only HTTP target for safely exercising monitor failures."""

from __future__ import annotations

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Literal

TargetMode = Literal["healthy", "failure", "timeout", "redirect"]


class TargetState:
    def __init__(self):
        self.mode: TargetMode = "healthy"
        self.lock = threading.Lock()
        self.redirect_requests = 0

    def set_mode(self, mode: TargetMode) -> None:
        with self.lock:
            self.mode = mode

    def get_mode(self) -> TargetMode:
        with self.lock:
            return self.mode

    def record_redirect_request(self) -> None:
        with self.lock:
            self.redirect_requests += 1


def create_server(port: int = 9100) -> tuple[ThreadingHTTPServer, TargetState]:
    state = TargetState()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/redirected":
                state.record_redirect_request()
                body = json.dumps({"status": "redirect followed"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path != "/health":
                self.send_error(404)
                return
            mode = state.get_mode()
            if mode == "timeout":
                time.sleep(3)
            if mode == "redirect":
                self.send_response(302)
                self.send_header("Location", "/redirected")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 200 if mode == "healthy" else 503
            message = "ok" if mode == "healthy" else "simulated failure"
            body = json.dumps({"status": message, "mode": mode}).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self):
            if self.path != "/__control/mode":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 128:
                    raise ValueError("invalid request size")
                payload = json.loads(self.rfile.read(length))
                mode = payload.get("mode")
                if mode not in {"healthy", "failure", "timeout", "redirect"}:
                    raise ValueError("unknown mode")
            except (ValueError, json.JSONDecodeError, AttributeError):
                self.send_error(400, "mode must be healthy, failure, timeout, or redirect")
                return
            state.set_mode(mode)
            body = json.dumps({"mode": mode}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server, state


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a loopback-only monitoring test target")
    parser.add_argument("--port", type=int, default=9100)
    args = parser.parse_args()
    server, _ = create_server(args.port)
    print(f"Test target listening on http://127.0.0.1:{server.server_port}/health")
    print("Modes: POST /__control/mode with {\"mode\": \"healthy|failure|timeout|redirect\"}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()