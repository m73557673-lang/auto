# AI Incident Commander

AI Incident Commander is a local-first incident operations application. Its FastAPI backend monitors a configured HTTP(S) health endpoint, stores checks and incident events in SQLite, and exposes incident analysis and incident-aware chat through a backend-only Gemini integration. The React and Vite frontend presents live monitoring data alongside the preserved Stitch design references.

## Prerequisites

- Python 3.11 or newer
- Node.js 18 or newer and npm
- SQLite support from the Python standard library

## Configure the backend

From the repository root, create a virtual environment, install backend dependencies, and copy the example configuration:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

Edit `backend/.env` locally. Set `MONITOR_TARGET_URL` to an HTTP(S) health endpoint and set `COMMANDER_API_TOKEN` to a long, random value. To enable Gemini analysis and chat, set one or more of `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, and `GEMINI_API_KEY_3`. The configured model defaults to `gemini-2.5-flash`; optional settings include `GEMINI_MODEL` and `GEMINI_TIMEOUT_SECONDS`.

Keep `ALLOW_PRIVATE_TARGETS=false` for normal targets. Enable it only for the loopback test target described in [MONITORING.md](MONITORING.md). The backend stores monitoring data and saved AI analyses in `backend/data/incidents.sqlite3` by default.

## Start the application

Start the backend from the repository root:

```bash
backend/.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

In a second terminal, start the frontend:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open port `5173` in GitHub Codespaces. During local development, Vite proxies `/api` requests to `127.0.0.1:8000` and reads `COMMANDER_API_TOKEN` from `backend/.env` for server-side proxy authentication. Leave `VITE_API_BASE_URL` blank in the root `.env` to use that proxy. The FastAPI schema is available at `http://localhost:8000/docs`.

## Tests and production build

Run the backend tests:

```bash
backend/.venv/bin/python -m pytest -q backend/tests
```

Build the frontend for production:

```bash
npm run build
```

## Security notes

- Never put Gemini keys or `COMMANDER_API_TOKEN` in frontend source, Vite client-side variables, or committed files. Keep `backend/.env` local; it is ignored by Git. Commit only the placeholder values in `backend/.env.example`.
- Gemini is optional: provider errors must not stop monitoring checks or incident creation and resolution.
- The monitor makes outbound GET requests only, rejects redirects, and blocks private IP addresses by default. Do not enable `ALLOW_PRIVATE_TARGETS` for an untrusted target.
- The local test target binds to loopback and must not be exposed publicly. See [MONITORING.md](MONITORING.md) for the safe failure walkthrough and configuration details.
- SQLite and the built-in development setup are intended for a single backend instance. Use suitable managed infrastructure and deployment security controls before production or multi-instance use.