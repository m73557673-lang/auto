from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=False)


def _positive_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _positive_float(name: str, default: float, minimum: float = 0.1) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _validate_url_syntax(target_url: str | None) -> None:
    if target_url is None:
        return
    try:
        parsed = urlsplit(target_url)
        parsed.port
    except ValueError as exc:
        raise ValueError("MONITOR_TARGET_URL must contain a valid URL and port") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("MONITOR_TARGET_URL must be an absolute HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None or "@" in parsed.netloc or parsed.fragment or parsed.query:
        raise ValueError("MONITOR_TARGET_URL cannot contain credentials, a query, or a fragment")


@dataclass(frozen=True)
class Settings:
    database_path: Path
    monitor_target_url: str | None
    service_name: str
    monitor_enabled: bool
    poll_interval_seconds: int
    failure_threshold: int
    request_timeout_seconds: float
    allow_private_targets: bool
    api_token: str | None
    cors_origins: tuple[str, ...]
    gemini_api_keys: tuple[str, ...] = ()
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: float = 30.0

    @classmethod
    def from_env(cls) -> Settings:
        target_url = os.getenv("MONITOR_TARGET_URL", "").strip() or None
        _validate_url_syntax(target_url)
        enabled_default = target_url is not None
        enabled_value = os.getenv("MONITOR_ENABLED", str(enabled_default)).lower()
        if enabled_value not in {"true", "false", "1", "0", "yes", "no"}:
            raise ValueError("MONITOR_ENABLED must be a boolean")
        enabled = enabled_value in {"true", "1", "yes"} and target_url is not None
        origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5000,http://127.0.0.1:5000,*"
            ).split(",")
            if origin.strip()
        )
        token = os.getenv("COMMANDER_API_TOKEN", "").strip() or None
        gemini_api_keys = tuple(
            key.strip()
            for key_name in ("GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3")
            for key in (os.getenv(key_name, ""),)
            if key.strip()
        )
        gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
        gemini_timeout_seconds = _positive_float("GEMINI_TIMEOUT_SECONDS", 30.0)

        is_serverless = bool(
            os.getenv("VERCEL")
            or os.getenv("VERCEL_ENV")
            or os.getenv("AWS_LAMBDA_FUNCTION_NAME")
            or not os.access(str(BACKEND_DIR), os.W_OK)
        )
        raw_db_path = os.getenv("DATABASE_PATH", "").strip()
        if is_serverless:
            if not raw_db_path or not raw_db_path.startswith("/tmp"):
                raw_db_path = "/tmp/incidents.sqlite3"
        elif not raw_db_path:
            raw_db_path = str(BACKEND_DIR / "data" / "incidents.sqlite3")

        return cls(
            database_path=Path(raw_db_path),
            monitor_target_url=target_url,
            service_name=os.getenv("MONITOR_SERVICE_NAME", "Target application").strip() or "Target application",
            monitor_enabled=enabled,
            poll_interval_seconds=_positive_int("MONITOR_INTERVAL_SECONDS", 30),
            failure_threshold=_positive_int("MONITOR_FAILURE_THRESHOLD", 3),
            request_timeout_seconds=_positive_float("MONITOR_TIMEOUT_SECONDS", 5.0),
            allow_private_targets=os.getenv("ALLOW_PRIVATE_TARGETS", "false").lower() in {"true", "1", "yes"},
            api_token=token,
            cors_origins=origins,
            gemini_api_keys=gemini_api_keys,
            gemini_model=gemini_model,
            gemini_timeout_seconds=gemini_timeout_seconds,
        )