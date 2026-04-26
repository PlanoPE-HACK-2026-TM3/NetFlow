# NetFlow — Run the Whole Stack in Docker

This package takes the `netflow-naren` branch of NetFlow and wraps it into a
single `docker compose` stack. After the setup below you do not need Python,
Node, `npm`, or Ollama installed locally — **Docker is the only prerequisite**.

---

## 1. What you're getting

Four services on one private Docker network:

| Service        | Image / source              | Port (host) | Purpose                                          |
|----------------|-----------------------------|-------------|--------------------------------------------------|
| `ollama`       | `ollama/ollama:latest`      | `11434`     | Local LLM server. Model weights live in a named volume so they survive restarts. |
| `ollama-init`  | `ollama/ollama:latest`      | — (one-shot)| Pulls `llama3` on first boot, then exits. Backend waits for this. |
| `backend`      | built from `backend/Dockerfile` | `8000`  | FastAPI + LangChain. Healthcheck on `/health`.   |
| `frontend`     | built from `frontend/Dockerfile` | `3000` | Next.js 16 UI. Starts only after backend is healthy. |

Dependency chain: `ollama` → `ollama-init` → `backend` → `frontend`.

---

## 2. Prerequisites

You need **one** of these installed and running:

- **Docker Desktop** (macOS / Windows) — includes Compose v2 out of the box.
- **Docker Engine + Compose plugin** (Linux) — `docker compose version` should return `v2.x`.

Verify:

```bash
docker --version
docker compose version
```

Recommended minimums: **8 GB RAM** free for Docker, **15 GB disk** (the
`llama3` weights alone are ~4.7 GB, plus base images).

---

## 3. Quick start (3 steps)

### Step 1 — Extract and enter the folder

```bash
unzip netflow-docker.zip
cd netflow-docker
```

### Step 2 — Run the setup script

macOS Archive Utility and some Windows extractors silently strip files whose
names start with a dot (`.env.example`, `.dockerignore`). To work around that,
every dotfile ships under **two names** in this archive — the original dotted
name and a safe non-dotted twin (e.g. `env.example`, `dockerignore`). The
setup script uses whichever survived extraction to recreate the dotfiles and
to produce your `.env` file.

```bash
# macOS / Linux
chmod +x setup.sh && ./setup.sh

# Windows (Command Prompt or PowerShell)
setup.bat
```

The defaults run the app in **DEMO_MODE=true** — no external API keys needed.
If you want live RentCast/FRED data, open `.env` afterwards and paste in your
keys.

> **Don't want to run the script?** You can do the same thing manually:
> ```bash
> cp env.example .env
> cp dockerignore .dockerignore               # optional
> cp frontend/dockerignore frontend/.dockerignore  # optional
> ```
> Only `.env` is strictly required for the stack to start — the
> `.dockerignore` files just keep the build context trim.

### Step 3 — Build and start everything

```bash
docker compose up --build -d
```

First run takes a while (**~10–20 min** depending on network) because it has
to:
1. Build the Python backend image.
2. Build the Next.js production bundle.
3. Pull `ollama/ollama` (~1 GB).
4. Download the `llama3` model (~4.7 GB) via the `ollama-init` sidecar.

Subsequent `up` calls start in seconds because everything is cached.

### Watching progress

Follow all logs interleaved:

```bash
docker compose logs -f
```

Or just one service:

```bash
docker compose logs -f backend
docker compose logs -f ollama-init   # watch the model download
```

You'll know it's ready when:

```bash
docker compose ps
```

…shows `backend` as `healthy` and `frontend` as `running`.

### Step 4 — Open the app

- **Frontend UI:** <http://localhost:3000>
- **Backend API docs (Swagger):** <http://localhost:8000/docs>
- **Backend health probe:** <http://localhost:8000/health>
- **Ollama API:** <http://localhost:11434>

---

## 4. Daily-driver commands

| Task                                     | Command                                      |
|------------------------------------------|----------------------------------------------|
| Start (after first build, uses cache)    | `docker compose up -d`                       |
| Stop (keep containers)                   | `docker compose stop`                        |
| Stop and remove containers               | `docker compose down`                        |
| Stop, remove, **and wipe the llama3 volume** | `docker compose down -v`                |
| Tail all logs                            | `docker compose logs -f`                     |
| Rebuild after editing backend code       | `docker compose up -d --build backend`       |
| Rebuild after editing frontend code      | `docker compose up -d --build frontend`      |
| Shell into a running service             | `docker compose exec backend /bin/bash`      |
| Show container status & health           | `docker compose ps`                          |

---

## 5. Configuration notes

### `.env` variables the stack respects

| Variable            | Default   | Meaning                                              |
|---------------------|-----------|------------------------------------------------------|
| `DEMO_MODE`         | `true`    | `true` = mock data + rule-based scoring. `false` = live APIs. |
| `DEBUG`             | `false`   | Verbose logging in backend.                          |
| `RENTCAST_API_KEY`  | *(empty)* | Required when `DEMO_MODE=false`.                     |
| `FRED_API_KEY`      | *(empty)* | Required when `DEMO_MODE=false`.                     |
| `LANGCHAIN_API_KEY` | *(empty)* | Optional — enables LangSmith tracing.                |

### Why `OLLAMA_BASE_URL` isn't in `.env`

The compose file sets `OLLAMA_BASE_URL=http://ollama:11434` directly in the
backend service's `environment:`. That overrides whatever is in `.env` and
forces the backend to talk to the Ollama **container** over the internal
Docker network rather than to `localhost`, which inside a container points
back at the container itself.

### Why `NEXT_PUBLIC_API_URL` is `http://localhost:8000`, not `http://backend:8000`

Next.js inlines `NEXT_PUBLIC_*` variables into the client-side JavaScript
bundle at **build time**. That bundle runs in your **browser**, which can't
resolve Docker's internal DNS name `backend`. So the URL has to be whatever
the browser can reach — the host-published port.

---

## 6. Architecture

```
                                  your browser
                                       │
                                       │  http://localhost:3000
                                       ▼
                        ┌──────────────────────────┐
                        │        frontend          │
                        │     Next.js 16 (3000)    │
                        └──────────────┬───────────┘
                                       │  http://localhost:8000
                                       │  (browser → host → backend:8000)
                                       ▼
                        ┌──────────────────────────┐
                        │         backend          │
                        │    FastAPI / uvicorn     │◄──┐
                        │          (8000)          │   │ OLLAMA_BASE_URL=
                        └──────────────┬───────────┘   │ http://ollama:11434
                                       │               │
                 ┌─────────────────────┴──────────┐    │
                 │                                │    │
                 ▼                                ▼    │
       RentCast / FRED APIs             ┌──────────────┴───┐
       (only when DEMO_MODE=false)      │      ollama      │
                                        │  llama3 (11434)  │
                                        └──────────┬───────┘
                                                   │
                                                   ▼
                                        ollama_data (named volume,
                                        llama3 weights persist here)
```

---

## 7. Troubleshooting

**`Error: .env: no such file`**
You skipped Step 2. Run `cp .env.example .env` and try again.

**`ollama-init` is still running after 10 minutes**
That's the `llama3` download (~4.7 GB). Watch it with
`docker compose logs -f ollama-init`. It will exit cleanly when done; then
the backend starts automatically.

**Backend stuck in `starting` / `unhealthy`**
Check the logs: `docker compose logs backend`. Most common cause is
`ollama-init` hasn't finished, so the backend is waiting on its
`service_completed_successfully` dependency. That is expected on first run.

**`npm ci` fails in the frontend build (lockfile / peer-dep mismatch)**
The frontend Dockerfile already runs `npm ci --legacy-peer-deps` to tolerate
a known mismatch between `eslint@^8.57.1` (pinned in `package-lock.json`) and
`eslint-config-next@16.2.3`'s peer requirement of `eslint>=9`. If `npm ci`
still fails for some other reason, regenerate the lockfile locally:

```bash
cd frontend && rm -rf node_modules package-lock.json && npm install --legacy-peer-deps && cd ..
docker compose build --no-cache frontend
docker compose up -d
```

**Port already in use (`bind: address already in use`)**
Another process is on `3000`, `8000`, or `11434`. Either kill it or remap
the host port in `docker-compose.yml` (e.g. `"3001:3000"`).

**Need to wipe everything and start over**

```bash
docker compose down -v --rmi local
docker compose up --build -d
```

This deletes the `ollama_data` volume, so `llama3` will be re-pulled.

---

## 8. What was changed vs. the original repo

All original source (`backend/`, `frontend/`, `langchain_agent/`, etc.) is
untouched. The containerization layer is purely additive:

```
netflow-docker/
├── .dockerignore           ← NEW
├── .env.example            ← NEW
├── docker-compose.yml      ← NEW
├── DOCKER_README.md        ← NEW (this file)
├── backend/
│   └── Dockerfile          ← NEW
├── frontend/
│   ├── .dockerignore       ← NEW
│   └── Dockerfile          ← NEW
└── ...everything else from the netflow-naren branch, unmodified
```

You can still run the project the old way with `./start.sh` if you ever want
to — nothing about that path was broken.
