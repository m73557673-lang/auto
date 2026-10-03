# Running AI Incident Commander on Replit

The project uses its existing React/Vite frontend and FastAPI backend. The configured
workflows are:

- **Start application** — serves the frontend on port 5000.
- **Backend API** — runs FastAPI on `127.0.0.1:8000`; Vite proxies `/api` requests
  to it. Keep the API bound to loopback.

Both workflows should be running to use the dashboard. The backend creates its
SQLite database at `backend/data/incidents.sqlite3` automatically.

## Configuration

Set `MONITOR_TARGET_URL` as a non-secret Replit environment variable to the public
HTTP(S) health endpoint the app should monitor. Until it is set, the application
runs with monitoring disabled.

Set `COMMANDER_API_TOKEN` as a Replit secret. The backend uses it to protect
monitoring actions, AI analysis, and incident chat; the Vite development proxy
forwards it server-side and does not expose it in browser code.

Gemini-powered incident analysis and chat also require `GEMINI_API_KEY` as a
Replit secret. The backend supports optional fallback keys
`GEMINI_API_KEY_2` and `GEMINI_API_KEY_3`. Without a Gemini key, monitoring and
incident tracking still work, but AI analysis and chat are unavailable.