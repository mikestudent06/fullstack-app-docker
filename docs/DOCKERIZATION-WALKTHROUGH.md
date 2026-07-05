# Dockerization Walkthrough — Step-by-Step Guide

A reusable, explained-from-scratch guide for dockerizing a full-stack Node.js app. Written for this project (`back/` + `front/` + external Neon Postgres) but the patterns apply to any similar setup.

Use this doc when you start a new project and want to remember **what each file does and why** — not just what to type.

---

## How to use this guide

1. Read each step in order the first time.
2. When dockerizing a new project, jump to **Step 9: Reuse checklist** and adapt names/ports.
3. Keep **Step 6** (browser vs container networking) open — it's the most common source of confusion.

---

## Step 1 — What you're actually doing (big picture)

### Without Docker

You run apps directly on your machine:

- `npm run dev` in the API folder → server on some port (e.g. `3000`)
- `npm run dev` in the frontend folder → dev server on another port (e.g. `5173`)
- Database may be local, cloud-hosted (Neon), or elsewhere

This works, but depends on **your laptop**: Node version, OS, installed tools, env quirks.

### With Docker

You package each app into a **container** — a small, isolated environment that runs the same way everywhere.

| Piece | Role |
|-------|------|
| `back/Dockerfile` | Recipe to build the API container image |
| `front/Dockerfile` | Recipe to build the frontend container image |
| `docker-compose.yml` (repo root) | One file to start all services together |
| Root `.env` | Shared secrets/config for Compose |

### Mental model

| Concept | Analogy |
|---------|---------|
| **Dockerfile** | Recipe |
| **Image** | The prepared dish blueprint (frozen snapshot) |
| **Container** | A serving of that dish (actually running) |
| **Compose** | The menu — "start kitchen + bar together, with these settings" |

### What goes in Docker vs what doesn't

| In Docker | Outside Docker (typical) |
|-----------|--------------------------|
| API (`back/`) | Managed Postgres (Neon, RDS, etc.) |
| Frontend (`front/`) | |
| | Anything you deliberately keep on the host |

**This project:** Neon Postgres stays in the cloud. Only the two Node apps are containerized. The API connects to Neon via `DATABASE_URL` over the internet.

---

## Step 2 — Where each file lives (and why)

### The rule

```
my-fullstack-app/              ← repo root
├── docker-compose.yml         ← HERE (orchestrator)
├── .env                       ← HERE (shared config, gitignored)
├── .env.example               ← HERE (template, committed)
│
├── back/                      ← or backend/, api/, etc.
│   ├── Dockerfile             ← API recipe only
│   └── .dockerignore
│
└── front/                     ← or frontend/, client/, etc.
    ├── Dockerfile             ← frontend recipe only
    └── .dockerignore
```

### Why `docker-compose.yml` is at the root

Compose coordinates **multiple services**. It must reference sibling folders:

```yaml
services:
  api:
    build: ./back
  client:
    build: ./front
```

If Compose lived inside `back/`, referencing `front/` becomes awkward (`../front`). At the root, both services are siblings.

You also **run Compose from the root**:

```bash
docker compose up --build
```

Compose looks for `docker-compose.yml` in the directory you're standing in.

### Why each `Dockerfile` lives inside its service folder

A Dockerfile's **build context** is the folder it's built from. `COPY` can only see files inside that context.

- `back/Dockerfile` → only cares about backend files
- `front/Dockerfile` → only cares about frontend files

Different base images, ports, and commands — no interference.

### Analogy

| File | Role |
|------|------|
| `docker-compose.yml` | Restaurant manager |
| `back/Dockerfile` | Kitchen recipe |
| `front/Dockerfile` | Bar recipe |

The manager sits at the top; each recipe lives at its own station.

---

## Step 3 — The API Dockerfile (`back/Dockerfile`)

Two moments matter: **build time** (`docker build`) and **run time** (`docker compose up`).

### Chunk 1 — Foundation

```dockerfile
FROM node:22-alpine

RUN addgroup app && adduser -S -G app app
WORKDIR /app
```

| Line | What it does | Why |
|------|--------------|-----|
| `FROM node:22-alpine` | Base image: Node 22 on minimal Alpine Linux | Reproducible runtime; small image (~5 MB base vs ~150 MB+ Debian). Pin version (`22`), not `latest`. |
| `addgroup` / `adduser` | Create unprivileged `app` user | Don't run as root in containers — smaller blast radius if compromised. |
| `WORKDIR /app` | Set working directory | All files and commands live in one predictable place. |

### Chunk 2 — Dependencies and layer caching

```dockerfile
COPY package*.json ./
RUN npm ci
```

| Line | What it does | Why |
|------|--------------|-----|
| `COPY package*.json ./` | Copy only `package.json` + lockfile | Not source code — on purpose (see below). |
| `RUN npm ci` | Install exact dependency versions | Reproducible; stricter than `npm install`. |

#### The caching trick (critical)

Docker caches each instruction. If inputs haven't changed, it **reuses** the cached layer.

**Good order (fast rebuilds):**

```
1. COPY package*.json     ← changes rarely
2. RUN npm ci             ← only re-runs when deps change
3. (source via bind mount at runtime)
```

**Bad order (slow rebuilds):**

```
1. COPY . .               ← any file change invalidates this layer
2. RUN npm ci               ← full reinstall on every code edit
```

**Rule:** Put rarely-changing steps **before** frequently-changing ones.

#### Why we don't `COPY src/` in a dev Dockerfile

| | `COPY` in Dockerfile | Bind mount at runtime |
|---|----------------------|------------------------|
| When | Build time | Run time |
| Effect | Freezes files **inside the image** | **Live link** to your laptop folder |
| Code change | Requires image rebuild | Instant — hot reload works |

For **development**, we want:

- **Image:** Node + `node_modules` (heavy, rarely changes)
- **Bind mount:** live `src/` from your machine

```dockerfile
# Built into image:
FROM node:22-alpine
COPY package*.json ./
RUN npm ci
# no COPY src/ here

# Added by Compose when container starts:
# ./back:/app  →  full folder plugged in live
```

**Analogy:**

- `COPY` = photocopying homework into a binder (update = photocopy again)
- Bind mount = binder linked to a live Google Doc (edit → instant update)

### Chunk 3 — Permissions, port, start command

```dockerfile
RUN chown -R app:app /app
USER app

EXPOSE 3000

CMD ["npm", "run", "dev"]
```

| Line | What it does | Why |
|------|--------------|-----|
| `chown -R app:app /app` | Give `app` user ownership of `/app` | Files created during build are owned by root; `app` needs read/write access. |
| `USER app` | Run as non-root from here on | Security best practice. |
| `EXPOSE 3000` | Documents expected port | **Documentation only** — doesn't open the port to your browser. Actual mapping is in Compose `ports:`. |
| `CMD ["npm", "run", "dev"]` | Default process when container starts | **Exec form** (JSON array) = PID 1 receives `SIGTERM` on `docker stop`. |

### Complete API Dockerfile (dev)

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

**After build, the image contains:** Node + `node_modules`.  
**At runtime, Compose adds:** live source code + environment variables.

---

## Step 4 — `.dockerignore`

When you `docker build`, Docker first gathers the **build context** (folder contents) and sends it to the daemon. `.dockerignore` excludes files — like `.gitignore` for builds.

Create one per service (`back/.dockerignore`, `front/.dockerignore`):

```
node_modules
dist
npm-debug.log
.env
.env.*
```

| Entry | Why exclude |
|-------|-------------|
| `node_modules` | Huge; we `npm ci` inside the image anyway. Host binaries may be wrong OS (Windows vs Linux). |
| `dist` | Build output; not needed for dev dep install. |
| `.env` / `.env.*` | **Secrets.** Prevents baking `DATABASE_URL` into image layers. |

### Build vs run

```
docker build  →  .dockerignore filters build context
docker compose up  →  bind mount still sees full folder (including .env on host for local use)
```

`.dockerignore` affects **build only**, not runtime bind mounts.

---

## Step 5 — Frontend Dockerfile + Vite tweak

### `front/Dockerfile`

Same pattern as the API. Only differences: port `5173` and `npm run dev` runs Vite.

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

| | API (`back/`) | Frontend (`front/`) |
|---|---------------|---------------------|
| Port | `3000` | `5173` |
| Dev command | `tsx watch` / nodemon | `vite` |
| Pattern | Identical | Identical |

### `host: true` in Vite (required for Docker)

Add to `front/vite.config.ts`:

```ts
server: {
  host: true,
  // ... proxy, etc.
},
```

**Why:** By default, Vite listens on `localhost` **inside the container only**. Your browser runs on your **laptop**, outside the container.

```
Without host: true:
  Browser → localhost:5173 → port mapped → Vite on 127.0.0.1 only → unreachable

With host: true:
  Browser → localhost:5173 → port mapped → Vite on 0.0.0.0 → works
```

`host: true` tells Vite to listen on all interfaces (`0.0.0.0`), so Docker's port mapping can reach it.

---

## Step 6 — Root `.env` (and the networking trap)

Compose automatically reads `.env` in the **same directory** as `docker-compose.yml`.

```env
DATABASE_URL=postgresql://...
PORT=3000
CORS_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:3000
```

Add `.env` to `.gitignore`. Commit `.env.example` with placeholders only.

### Who uses each variable

| Variable | Service | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `api` | External DB connection (Neon, etc.) |
| `PORT` | `api` | API listen port |
| `CORS_ORIGIN` | `api` | Which frontend origin may call the API |
| `VITE_API_URL` | `client` | Where browser-side `fetch` goes |

### Why `VITE_API_URL` must be `localhost`, not `api`

Three places code can run:

```
┌─────────────────────────────────────────────────────────┐
│  YOUR LAPTOP (host)                                     │
│                                                         │
│   Browser  ──fetch──►  localhost:3000  (mapped to API)  │
│       │                                                 │
│       └── page from ──►  localhost:5173  (mapped to UI) │
│                                                         │
│  ┌──────────── Docker network ────────────┐             │
│  │  client container    api container     │             │
│  │  hostname: client     hostname: api    │             │
│  └────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

**React code runs in the browser** — on your laptop, **outside** Docker's network.

| URL | Works from browser? | Works container-to-container? |
|-----|----------------------|-------------------------------|
| `http://localhost:3000` | Yes (via port mapping) | No |
| `http://api:3000` | No (browser doesn't know Docker DNS) | Yes |

`api` is Docker's internal hostname. Use it for **server-side** calls inside the network. Use `localhost` for **browser-side** calls via mapped ports.

### Why `CORS_ORIGIN` matters

Browser loads page from `http://localhost:5173` but fetches from `http://localhost:3000` — different origins (ports count).

The API must explicitly allow the frontend origin:

```ts
cors({ origin: process.env.CORS_ORIGIN })
```

### Without Docker vs with Docker

| | Without Docker | With Docker |
|---|----------------|-------------|
| Frontend → API | Vite proxy forwards `/api` → `localhost:3000` | Browser calls API directly at `localhost:3000` |
| `VITE_API_URL` | Can stay empty | Set to `http://localhost:3000` |

---

## Step 7 — `docker-compose.yml`

Compose replaces manual `docker network create` + `docker build` + `docker run` with one declarative file.

### API service

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
```

| Key | Manual equivalent | What it does |
|-----|-------------------|--------------|
| `build: ./back` | `docker build ./back` | Build image from `back/Dockerfile` |
| `container_name` | `--name task_api` | Stable name for logs/debugging |
| `ports: "3000:3000"` | `-p 3000:3000` | Host port → container port |
| `./back:/app` | `-v ./back:/app` | Bind mount — live code, hot reload |
| `/app/node_modules` | `-v /app/node_modules` | Protect Linux `node_modules` from bind mount overwrite |
| `environment:` | `-e KEY=val` | Inject config from root `.env` |
| `${PORT:-3000}` | — | Use `PORT` from `.env`, default `3000` |

#### The `node_modules` volume trick (explained)

Bind mount `./back:/app` replaces **everything** in `/app`, including `node_modules` from the image.

The anonymous volume `/app/node_modules` says: **keep this path from the image; don't let the mount overwrite it.**

| Path in container | Source |
|-------------------|--------|
| `/app/src/` | Your laptop (live) |
| `/app/package.json` | Your laptop (live) |
| `/app/node_modules/` | Image (Linux deps, protected) |

### Client service

```yaml
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

Frontend doesn't need `DATABASE_URL` — only the API talks to the database.

#### `depends_on`

```yaml
depends_on:
  - api
```

- **Does:** start `api` container before `client`
- **Does not:** wait until Express is ready or DB is connected

For production-grade startup order, add `healthcheck` + `condition: service_healthy`. Fine to skip for learning/simple apps.

#### Network (automatic)

Compose creates a private network. Service name `api` becomes an internal DNS hostname for other containers. Browser still uses `localhost` + mapped ports.

---

## Step 8 — Run it and verify

### Checklist before first run

```
□ docker-compose.yml at repo root
□ Root .env with real DATABASE_URL
□ back/Dockerfile + back/.dockerignore
□ front/Dockerfile + front/.dockerignore
□ front/vite.config.ts has host: true
```

### Command

From repo root:

```bash
docker compose up --build    # first time, or after Dockerfile / package.json changes
docker compose up            # normal dev day — code-only edits
```

See **[DOCKER-REFERENCE.md](./DOCKER-REFERENCE.md#1-docker-compose-up-vs-docker-compose-up---build)** for the full `up` vs `up --build` explanation.

Use `--build` after Dockerfile or `package.json` changes.

### What happens (in order)

1. Compose reads `docker-compose.yml` + root `.env`
2. **Build:** `docker build` for `back/` and `front/` (cached layers when possible)
3. **Network:** private Docker network created
4. **Start `api`:** mount code, inject env, run `npm run dev`
5. **Start `client`:** mount code, inject `VITE_API_URL`, run Vite

### Verify

| Check | Expected |
|-------|----------|
| Terminal logs | `API listening on http://localhost:3000` |
| | `VITE ... ready` on port 5173 |
| Browser `http://localhost:5173` | App loads, health shows `ok · connected` |
| `http://localhost:3000/api/health` | `{"status":"ok","database":"connected"}` |
| Edit a source file + save | Hot reload without rebuild |

### Useful commands

| Command | Purpose |
|---------|---------|
| `docker compose up --build` | Build (if needed) + start |
| `docker compose up -d` | Detached (background) |
| `docker compose logs -f` | Follow all logs |
| `docker compose logs -f api` | API logs only |
| `docker compose down` | Stop and remove containers + network |
| `docker ps` | List running containers |

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Port 5173 unreachable | Vite bound to container localhost | `host: true` in `vite.config.ts` |
| `Failed to fetch` / CORS | Wrong URLs | `VITE_API_URL=http://localhost:3000`, `CORS_ORIGIN=http://localhost:5173` |
| `DATABASE_URL is required` | Missing root `.env` or not passed to `api` | Create root `.env`, check `environment:` block |
| Module / npm errors | Host `node_modules` overwrote container's | Ensure `/app/node_modules` volume line exists |
| Deps broken after `package.json` change | Stale volume/cache | `docker compose down` then `docker compose up --build` |

---

## Step 9 — Reuse checklist for your next project

Copy this when dockerizing a new full-stack app.

### 1. Decide what goes in containers

- [ ] API → yes
- [ ] Frontend → yes
- [ ] Database → local container **or** managed service (Neon, etc.)?

### 2. Create file layout

- [ ] `docker-compose.yml` at repo root
- [ ] `.env.example` at repo root
- [ ] `<api-folder>/Dockerfile` + `.dockerignore`
- [ ] `<frontend-folder>/Dockerfile` + `.dockerignore`

### 3. Adapt ports and names

| This project | Your next project |
|--------------|-------------------|
| `back/` | `backend/`, `api/`, etc. |
| `front/` | `frontend/`, `client/`, etc. |
| API port `3000` | Whatever your API uses |
| Vite port `5173` | Vite default or your choice |
| Service names `api`, `client` | Any names (affects internal DNS only) |

Update `build:`, `ports:`, `volumes:`, and `CORS_ORIGIN` to match.

### 4. Dev Dockerfile template (copy-paste starter)

```dockerfile
FROM node:22-alpine

RUN addgroup app && adduser -S -G app app
WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN chown -R app:app /app
USER app

EXPOSE <PORT>

CMD ["npm", "run", "dev"]
```

### 5. Compose service template

```yaml
services:
  api:
    build: ./<api-folder>
    ports:
      - "<API_PORT>:<API_PORT>"
    volumes:
      - ./<api-folder>:/app
      - /app/node_modules
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - PORT=${PORT:-<API_PORT>}
      - CORS_ORIGIN=${CORS_ORIGIN:-http://localhost:<FRONTEND_PORT>}

  client:
    build: ./<frontend-folder>
    ports:
      - "<FRONTEND_PORT>:<FRONTEND_PORT>"
    volumes:
      - ./<frontend-folder>:/app
      - /app/node_modules
    environment:
      - VITE_API_URL=${VITE_API_URL:-http://localhost:<API_PORT>}
    depends_on:
      - api
```

### 6. Framework-specific extras

| Framework | Extra step |
|-----------|------------|
| Vite | `host: true` in `vite.config.ts` |
| Next.js | May need different prod vs dev setup |
| Create React App | Similar to Vite; check dev server host binding |
| Webpack dev server | `host: '0.0.0.0'` in dev config |

### 7. Run and verify

```bash
cp .env.example .env
# fill in secrets
docker compose up --build
```

---

## Step 10 — Production direction (when you're ready)

Dev setup uses bind mounts and dev servers. Production differs:

| Dev | Production |
|-----|------------|
| `npm run dev` in container | `npm run build` → serve static files or `node dist/index.js` |
| Bind mounts for hot reload | No bind mounts — code baked into image |
| Single-stage Dockerfile | **Multi-stage** Dockerfile |
| `npm ci` (all deps) | `npm ci --omit=dev` in final stage |

Example production API pattern (concept):

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

Use separate Compose files: `docker-compose.yml` (dev) + `docker-compose.prod.yml` (prod), merged with:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up
```

---

## Quick reference — concepts at a glance

| Term | One-line definition |
|------|---------------------|
| **Image** | Read-only blueprint (layered filesystem) |
| **Container** | Image + thin writable layer + running process |
| **Build context** | Files Docker can see during `docker build` |
| **Bind mount** | Live folder link: host path ↔ container path |
| **Anonymous volume** | Docker-managed storage (e.g. protect `node_modules`) |
| **EXPOSE** | Documents port; doesn't publish it |
| **ports** in Compose | Actually maps host port to container port |
| **depends_on** | Startup order only, not readiness |
| **.dockerignore** | Excludes files from build context |

**More concepts:** volumes (named vs bind vs anonymous), disk space, healthchecks, container counts → **[DOCKER-REFERENCE.md](./DOCKER-REFERENCE.md)**

---

## This project's file map

```
fullstack-app-docker/
├── docker-compose.yml
├── .env.example
├── .env                    ← you create (gitignored)
├── docs/
│   ├── DOCKERIZATION-WALKTHROUGH.md   ← this file
│   ├── POSTGRES-IN-DOCKER.md
│   ├── DOCKER-REFERENCE.md
│   ├── CI-CD.md
│   └── DEPLOYMENT.md
├── back/
│   ├── Dockerfile
│   ├── .dockerignore
│   └── src/
└── front/
    ├── Dockerfile
    ├── .dockerignore
    └── vite.config.ts      ← host: true
```

---

*Keep this doc in `docs/` and copy the Step 9 checklist into your next repo when you dockerize again.*
