# Fullstack DevOps Training App

A minimal fullstack app for DevOps practice: **React + Vite + TypeScript** frontend, **Node.js + Express + TypeScript** API, and **Neon Postgres**.

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | React 19, Vite 8, TypeScript |
| Backend  | Node.js, Express 5, TypeScript |
| Database | Neon Postgres (`@neondatabase/serverless`) — hosted, not containerized |

## API endpoints

| Method | Path           | Description              |
|--------|----------------|--------------------------|
| GET    | `/api/health`  | Health check + DB ping   |
| GET    | `/api/tasks`   | List tasks               |
| POST   | `/api/tasks`   | Create task `{ "title": "..." }` |

---

## Local setup (without Docker)

### 1. Neon database

1. Create a free project at [console.neon.tech](https://console.neon.tech).
2. Copy the **connection string** (with `?sslmode=require`).

### 2. Backend

```bash
cd back
cp .env.example .env
# Edit .env and paste your DATABASE_URL

npm install
npm run dev
```

API runs at `http://localhost:3000`.

### 3. Frontend

```bash
cd front
npm install
npm run dev
```

App runs at `http://localhost:5173`. Vite proxies `/api` requests to the backend during development.

---

## Project structure

```
fullstack-app-docker/              ← repo root (where you run Compose)
├── docker-compose.yml
├── .env                           ← shared secrets (gitignored)
├── .env.example
├── .gitignore
├── README.md
├── docs/
│   ├── DOCKERIZATION-WALKTHROUGH.md   ← step-by-step Docker guide (reusable)
│   ├── POSTGRES-IN-DOCKER.md          ← local Postgres container vs Neon
│   └── DOCKER-REFERENCE.md            ← volumes, up vs --build, disk space
│
├── back/                          ← Express API
│   ├── Dockerfile
│   ├── .dockerignore
│   └── src/
│
└── front/                         ← React Vite app
    ├── Dockerfile
    ├── .dockerignore
    ├── vite.config.ts
    └── src/
```

**Docker deep dive:** For the full explained walkthrough (every step, every "why"), see **[docs/DOCKERIZATION-WALKTHROUGH.md](docs/DOCKERIZATION-WALKTHROUGH.md)**.

**Postgres in Docker:** To run a local Postgres container instead of Neon, see **[docs/POSTGRES-IN-DOCKER.md](docs/POSTGRES-IN-DOCKER.md)**.

**Docker reference:** Volumes, `up` vs `--build`, disk space, healthchecks — **[docs/DOCKER-REFERENCE.md](docs/DOCKER-REFERENCE.md)**.

**Placement rule:** `docker-compose.yml` and the root `.env` always live at the repo root — one level above `back/` and `front/`. Each service keeps its own `Dockerfile` inside its folder. Compose points at them with `build: ./back` and `build: ./front`.

**Why we don't Dockerize Neon:** Neon is a managed Postgres service in the cloud. Our API connects to it over the internet using `DATABASE_URL`. There is no database container in this project — only the two app services.

---

## Dockerizing this project

This section walks through how **this repo** gets containerized, step by step, with the reasoning behind each decision.

### What we're building

| Service (Compose name) | Folder   | Port | Role |
|------------------------|----------|------|------|
| `api`                  | `back/`  | 3000 | Express API, talks to Neon |
| `client`               | `front/` | 5173 | Vite dev server + React UI |

In **development mode**, we want:

- Hot reload when you edit files on your host
- Both containers on one Docker network so they can resolve each other by name
- The browser on your laptop reaching both services via mapped ports (`localhost:3000`, `localhost:5173`)

### Step 0 — One small Vite change for Docker

By default, Vite only listens inside the container. The browser runs on your **host**, so we need Vite to bind to all interfaces.

In `front/vite.config.ts`, add `host: true` under `server`:

```ts
server: {
  host: true,
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
  },
},
```

**Why:** Without this, `docker-compose` maps port `5173:5173` but nothing is listening on the container's external interface — the app would be unreachable from your browser.

### Step 1 — Backend Dockerfile (`back/Dockerfile`)

```dockerfile
FROM node:22-alpine

RUN addgroup app && adduser -S -G app app
WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN chown -R app:app /app
USER app

EXPOSE 3000

CMD ["npm", "run", "dev"]
```

| Line | What it does | Why it matters here |
|------|--------------|---------------------|
| `FROM node:22-alpine` | Minimal Linux + Node runtime | Small image, fast pulls. Pinned major version — not `latest` — so builds stay reproducible. |
| `addgroup` / `adduser` | Creates unprivileged `app` user | Processes shouldn't run as root in containers. If the app is compromised, the blast radius is smaller. |
| `WORKDIR /app` | All following commands run in `/app` | Keeps the container filesystem predictable. |
| `COPY package*.json` **before** source | Copies only manifests first | Docker caches layers. Dependencies reinstall only when `package-lock.json` changes — not on every `.ts` edit. |
| `npm ci` | Installs exact versions from lockfile | Reproducible installs in CI and Docker (stricter than `npm install`). |
| `chown` + `USER app` | Files owned by `app`; runtime runs as `app` | The `app` user must read `node_modules` and write caches during hot reload. |
| `EXPOSE 3000` | Documents the port | Documentation only — actual publishing happens in Compose `ports:`. Our API defaults to port `3000`. |
| `CMD ["npm", "run", "dev"]` | Runs `tsx watch` for hot reload | Exec form (JSON array) = PID 1 receives `SIGTERM` correctly on `docker stop`. |

We intentionally **do not** `COPY . .` in this dev Dockerfile. Source code arrives via a **bind mount** at runtime (see Compose below), which is what makes `tsx watch` see your saves instantly.

### Step 2 — Frontend Dockerfile (`front/Dockerfile`)

```dockerfile
FROM node:22-alpine

RUN addgroup app && adduser -S -G app app
WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN chown -R app:app /app
USER app

EXPOSE 5173

CMD ["npm", "run", "dev"]
```

Same pattern as the backend. Vite's default dev port is `5173`, which matches our local setup.

### Step 3 — `.dockerignore` (one per service)

Create `back/.dockerignore` and `front/.dockerignore`:

```
node_modules
dist
npm-debug.log
.env
.env.*
```

**Why:** When Docker builds an image, it sends a "build context" (the folder contents) to the daemon. Ignoring `node_modules` keeps builds fast and avoids copying host binaries that may not match Linux inside the container. Ignoring `.env` prevents secrets from being baked into image layers.

### Step 4 — Root `.env` for Compose

Create `.env` at the **repo root** (next to `docker-compose.yml`):

```env
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
PORT=3000
CORS_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:3000
```

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `api` | Neon connection string — the API reaches Neon over the public internet from inside the container. |
| `PORT` | `api` | Express listens on `3000`. |
| `CORS_ORIGIN` | `api` | Allows browser requests from the Vite app at `http://localhost:5173`. |
| `VITE_API_URL` | `client` | Tells the React app where to `fetch` the API. |

**Important networking detail:** The React code runs in **your browser**, not inside the `client` container. So `VITE_API_URL` must be `http://localhost:3000` (the host-mapped port), **not** `http://api:3000`. The hostname `api` only works for container-to-container calls on Docker's internal network — your browser is outside that network.

Locally without Docker, we leave `VITE_API_URL` empty and rely on Vite's `/api` proxy. In Docker, we set it explicitly because the browser calls the API directly and CORS handles cross-origin access.

### Step 5 — `docker-compose.yml` at the repo root

```yaml
services:
  api:
    build: ./back
    container_name: task_api
    ports:
      - "3000:3000"
    volumes:
      - ./back:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - DATABASE_URL=${DATABASE_URL}
      - PORT=${PORT:-3000}
      - CORS_ORIGIN=${CORS_ORIGIN:-http://localhost:5173}

  client:
    build: ./front
    container_name: task_client
    ports:
      - "5173:5173"
    volumes:
      - ./front:/app
      - /app/node_modules
    environment:
      - VITE_API_URL=${VITE_API_URL:-http://localhost:3000}
    depends_on:
      - api
```

**Mapping each block to what it replaces:**

| Compose key | Manual equivalent | What it does in our app |
|-------------|-------------------|-------------------------|
| `build: ./back` | `docker build -t api-image ./back` | Builds the API image from `back/Dockerfile`. |
| `ports: "3000:3000"` | `-p 3000:3000` | Maps host port 3000 → container port 3000 so you open `http://localhost:3000/api/health`. |
| `./back:/app` | `-v "$(pwd)":/app` | Bind mount: your local `back/` folder is the container's `/app`. Edit a file → `tsx watch` restarts. |
| `/app/node_modules` | `-v /app/node_modules` | Anonymous volume that **protects** Linux `node_modules` inside the container from being overwritten by the bind mount (which would otherwise replace them with your host's `node_modules` or an empty folder). |
| `environment:` | `-e KEY=VALUE` | Injects Neon URL, port, and CORS config without hardcoding secrets in the YAML. |
| `depends_on: - api` | Start API first | Compose starts `api` before `client`. **Note:** this only waits for the container to start, not for Express to be ready — fine here because the frontend retries on load. |
| *(implicit network)* | `docker network create ...` | Compose creates a network automatically. Service name `api` becomes a DNS hostname for other containers. |

There is **no `db` service** — Neon lives outside Docker.

### Step 6 — Run it

From the repo root:

```bash
docker compose up --build
```

| Flag / command | When to use it |
|----------------|----------------|
| `docker compose up` | Start everything; rebuild only if images are missing. |
| `docker compose up --build` | Force rebuild after changing a `Dockerfile` or `package.json`. |
| `docker compose up -d` | Detached mode — containers run in the background. |
| `docker compose down` | Stop and remove containers + Compose network. |
| `docker compose logs -f` | Stream logs from both services. |
| `docker compose logs -f api` | Logs from the API only. |

Open **http://localhost:5173** — you should see API health `ok · connected` and be able to add tasks.

### What happens under the hood on `docker compose up --build`

1. Docker reads `docker-compose.yml` and the root `.env`.
2. For each service, it builds an image from the respective `Dockerfile` (reusing cached layers when `package*.json` hasn't changed).
3. Compose creates a private network and starts `api`, then `client`.
4. Bind mounts wire your local `back/` and `front/` into the containers.
5. The API container starts `tsx watch`, connects to Neon via `DATABASE_URL`, and listens on port 3000.
6. The Vite container starts, serves React on port 5173, and the browser fetches the API at `http://localhost:3000`.

### Manual mode (without Compose) — for learning

If you want to feel each step the way the course describes:

```bash
# 1. Network so containers resolve each other by name
docker network create task-app-network

# 2. Build images
docker build -t task-api ./back
docker build -t task-client ./front

# 3. Run API (from repo root; pass your real DATABASE_URL)
docker run -d --name task_api --network task-app-network \
  -p 3000:3000 \
  -v "./back:/app" -v /app/node_modules \
  -e DATABASE_URL="your-neon-url" \
  -e CORS_ORIGIN="http://localhost:5173" \
  task-api

# 4. Run frontend
docker run -d --name task_client --network task-app-network \
  -p 5173:5173 \
  -v "./front:/app" -v /app/node_modules \
  -e VITE_API_URL="http://localhost:3000" \
  task-client
```

Compose exists because retyping five commands every day is painful — it's the same operations, declared once in YAML.

---

## Production direction (later)

The dev setup above is intentionally simple for learning. When you move to production, you'll typically:

1. **Multi-stage Dockerfiles** — build TypeScript in one stage, copy only `dist/` into a slim final image.
2. **Use `npm ci --omit=dev`** in the production stage — no `tsx`, no Vite dev server.
3. **Serve the frontend as static files** (`npm run build` → nginx or `vite preview`) instead of the Vite dev server.
4. **Separate Compose file** — e.g. `docker-compose.yml` (dev) + `docker-compose.prod.yml` (production), merged with `docker compose -f docker-compose.yml -f docker-compose.prod.yml up`.
5. **Keep secrets in `.env` or a secrets manager** — never commit `DATABASE_URL` to git.

Example production API stage (concept only — you'll add this when ready):

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
```

---

## Quick reference — files to create

When you're ready to dockerize, add these files:

```
fullstack-app-docker/
├── docker-compose.yml       ← Step 5
├── .env                     ← Step 4 (gitignored)
├── back/
│   ├── Dockerfile           ← Step 1
│   └── .dockerignore        ← Step 3
└── front/
    ├── Dockerfile           ← Step 2
    └── .dockerignore        ← Step 3
```

Plus the one-line `host: true` change in `front/vite.config.ts` (Step 0).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Frontend unreachable at `:5173` | Vite bound to localhost inside container | Add `host: true` in `vite.config.ts` |
| `Failed to fetch` / CORS errors | Wrong `VITE_API_URL` or `CORS_ORIGIN` | Use `http://localhost:3000` and `http://localhost:5173` (browser-side URLs) |
| `DATABASE_URL is required` | Env not passed to `api` container | Check root `.env` and Compose `environment:` block |
| `npm` errors after mount | Host `node_modules` overwrote container's | Ensure `/app/node_modules` anonymous volume is present |
| Changes to `package.json` ignored | Cached `node_modules` volume | `docker compose down` then `docker compose up --build` |
| API works locally but not in Docker | Neon IP allowlist / network | Neon is cloud-hosted — usually works from anywhere; verify connection string and `sslmode=require` |
