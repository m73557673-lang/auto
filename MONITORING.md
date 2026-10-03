# Monitoring Backend

The backend is a separate FastAPI service. It stores checks, incidents, and incident events in SQLite at `backend/data/incidents.sqlite3` by default. SQLite keeps this single-instance Codespaces setup self-contained; use a managed database before running multiple backend workers or replicas.

The configured monitor makes outbound GET requests only to `MONITOR_TARGET_URL`. It accepts HTTP(S), rejects credentials, query strings and fragments, checks DNS results on every check, blocks non-public IP addresses by default, and pins the connection to the addresses that passed those checks. It does not follow redirects, ignores ambient proxy settings, and applies a total timeout covering DNS and HTTP. `ALLOW_PRIVATE_TARGETS=true` is only for the loopback test target and must not be enabled when monitoring an untrusted URL. The backend never executes commands or changes the monitored application.

## Setup

From the repository root:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

Edit `backend/.env`: set `MONITOR_TARGET_URL` to the target application's HTTP(S) health endpoint and set `COMMANDER_API_TOKEN` to a random local token. Keep `ALLOW_PRIVATE_TARGETS=false` for normal targets. The backend reads this file; it is ignored by Git.

Start the backend in one terminal:

```bash
backend/.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Start the frontend in another terminal:

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Open port `5173` in Codespaces. Vite proxies `/api` calls to `127.0.0.1:8000`; `VITE_API_BASE_URL` is only needed if the API is hosted separately. The API's interactive schema is available at `/docs` on the backend.

Run automated backend tests from the repository root:

```bash
backend/.venv/bin/python -m pytest -q backend/tests
```

## Safe Failure Walkthrough

The simulator binds only to `127.0.0.1` and is intended for local development. Do not forward its port publicly.

1. Run the local target in a terminal:

   ```bash
   backend/.venv/bin/python -m backend.test_target --port 9100
   ```

2. In `backend/.env`, set the following local-only values. Choose an interval and threshold that make the example easy to observe:

   ```dotenv
   MONITOR_TARGET_URL=http://127.0.0.1:9100/health
   MONITOR_SERVICE_NAME=Local test target
   MONITOR_ENABLED=true
   MONITOR_INTERVAL_SECONDS=2
   MONITOR_FAILURE_THRESHOLD=2
   MONITOR_TIMEOUT_SECONDS=1
   ALLOW_PRIVATE_TARGETS=true
   ```

   `ALLOW_PRIVATE_TARGETS=true` is required only because this explicit test target uses loopback. Do not use it with arbitrary targets.

3. Restart the backend with the command above and open the frontend. The live panel should report a healthy local target after its first polling cycle.

4. Simulate an outage from another terminal:

   ```bash
   curl -X POST http://127.0.0.1:9100/__control/mode \
     -H 'Content-Type: application/json' \
     -d '{"mode":"failure"}'
   ```

   After two consecutive checks, the panel should show an active incident, HTTP 503, response time, event history, and check logs. Select the incident to inspect its detail and timeline.

5. Recover the target:

   ```bash
   curl -X POST http://127.0.0.1:9100/__control/mode \
     -H 'Content-Type: application/json' \
     -d '{"mode":"healthy"}'
   ```

   After the next check, the incident should be marked resolved and remain in incident history. Use `{"mode":"timeout"}` to exercise request timeouts; return to `healthy` to resolve that incident.

The authenticated manual-check and event-ingest endpoints require `Authorization: Bearer <COMMANDER_API_TOKEN>`. The token is backend-only and must not be added to Vite variables or browser code. Read-only endpoints are `GET /api/health`, `/api/monitoring/status`, `/api/services`, `/api/incidents`, `/api/incidents/{id}`, `/api/incidents/{id}/events`, and `/api/incidents/{id}/logs`. `POST /api/monitoring/check` performs one check of the configured target; `POST /api/monitoring/events` accepts validated authenticated external monitor events.

The live panel uses these backend endpoints. The preserved Stitch iframe pages are still static design samples, and their AI analysis/chatbot content is not connected to this monitor.