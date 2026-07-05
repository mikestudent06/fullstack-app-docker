# Postgres in Docker (vs Neon)

How this project would change if you ran **PostgreSQL inside Docker** instead of using **Neon** (managed/serverless Postgres in the cloud).

Use this when you want a fully local stack — API, frontend, and database — all started with one `docker compose up`.

---

## Short answer

**Yes — you add a Postgres image as a third service in `docker-compose.yml`.**

You do **not** install Postgres on your laptop. Docker pulls the official `postgres` image and runs it in its own container.

```
Before (Neon):          After (Docker Postgres):

  Browser                 Browser
     │                       │
  front + back             front + back
     │                       │
     └──► Neon (cloud)       └──► db container (local)
```

---

## Neon vs Docker Postgres — at a glance

| | **Neon (current setup)** | **Postgres in Docker** |
|---|--------------------------|------------------------|
| Where DB runs | Neon’s cloud | Container on your machine |
| `docker-compose` services | `api` + `client` | `api` + `client` + **`db`** |
| `DATABASE_URL` host | `ep-xxx.neon.tech` | `db` (Compose service name) |
| Data persistence | Neon manages it | **Named Docker volume** you define |
| Internet required | Yes (for DB) | No (fully offline dev) |
| Node driver | `@neondatabase/serverless` | `pg` (standard Postgres client) |
| SSL | Usually `?sslmode=require` | Not needed inside Docker network |
| Ops burden | Low (managed) | You manage backups, upgrades, disk |

---

## What changes in the project

### 1. `docker-compose.yml` — add a `db` service

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: task_db
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-app}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-appsecret}
      POSTGRES_DB: ${POSTGRES_DB:-tasks}
    ports:
      - "5432:5432"          # optional: for DBeaver/pgAdmin on your laptop
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-tasks}"]
      interval: 5s
      timeout: 5s
      retries: 5

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
      - DATABASE_URL=postgresql://${POSTGRES_USER:-app}:${POSTGRES_PASSWORD:-appsecret}@db:5432/${POSTGRES_DB:-tasks}
      - PORT=${PORT:-3000}
      - CORS_ORIGIN=${CORS_ORIGIN:-http://localhost:5173}
    depends_on:
      db:
        condition: service_healthy

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

volumes:
  postgres_data:
```

### Line-by-line: what the `db` service does

| Key | Purpose |
|-----|---------|
| `image: postgres:16-alpine` | Official Postgres image. Pin version (`16`), not `latest`. Alpine = small. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Creates DB + user on first start. Postgres image reads these env vars automatically. |
| `volumes: postgres_data:/var/lib/postgresql/data` | **Named volume** — plug persistent disk into Postgres data path. See [volume types](./DOCKER-REFERENCE.md#2-volume-types--bind-anonymous-named). |
| `healthcheck` + `pg_isready` | Proves Postgres accepts connections before the API starts. Full explanation → [healthchecks](./DOCKER-REFERENCE.md#5-healthchecks--what-they-do). |
| `ports: "5432:5432"` | Optional. Lets GUI tools on your laptop connect to `localhost:5432`. The API does **not** need this — it uses internal hostname `db`. |

### Why `depends_on` with `condition: service_healthy`

Plain `depends_on: - db` only waits for the **container** to start, not for Postgres to be ready. The API would often crash with "connection refused" on first boot.

```yaml
depends_on:
  db:
    condition: service_healthy
```

Compose waits until `pg_isready` succeeds, then starts `api`.

---

## `DATABASE_URL` — who talks to whom

Only the **API container** connects to Postgres. The browser and React app never touch the database.

### Container → container (API → DB)

```
postgresql://app:appsecret@db:5432/tasks
                          ↑
                    Compose service name (internal DNS)
```

Inside Docker’s network, hostname `db` resolves to the Postgres container. **No `localhost`** — `localhost` inside the API container would mean the API itself, not the DB.

### Laptop → DB (optional, for GUI tools)

If you exposed port `5432`:

```
Host:     localhost
Port:     5432
User:     app
Password: appsecret
Database: tasks
```

Same credentials, but `localhost` because you’re connecting from **outside** Docker.

### Compare to Neon

| Connection from | Neon URL host | Docker Postgres host |
|-----------------|---------------|----------------------|
| API container | `ep-xxx.neon.tech` | `db` |
| Your laptop (GUI) | Neon console connection string | `localhost:5432` |

---

## Root `.env` — what it would look like

```env
POSTGRES_USER=app
POSTGRES_PASSWORD=appsecret
POSTGRES_DB=tasks

PORT=3000
CORS_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:3000
```

You can drop a hand-written `DATABASE_URL` from `.env` and build it in Compose (as in the YAML above), or set it explicitly:

```env
DATABASE_URL=postgresql://app:appsecret@db:5432/tasks
```

**Note:** `@db` only works **inside** the API container. If you run the API **outside** Docker but DB **inside**, use `@localhost:5432` instead.

---

## Code change required — swap the database driver

The current `back/src/db.ts` uses Neon's serverless driver:

```ts
import { neon } from '@neondatabase/serverless';
export const sql = neon(connectionString);
```

That driver is built for Neon's HTTP/WebSocket proxy. A standard Postgres container speaks the normal Postgres wire protocol, so you switch to **`pg`**:

### Install

```bash
cd back
npm install pg
npm install -D @types/pg
npm uninstall @neondatabase/serverless
```

### Example `back/src/db.ts` with `pg`

```ts
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

export const pool = new pg.Pool({ connectionString });

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
```

### Example query changes in routes

Neon tagged template:

```ts
const tasks = await sql`SELECT id, title, created_at FROM tasks ORDER BY created_at DESC`;
```

With `pg`:

```ts
const { rows: tasks } = await pool.query(
  'SELECT id, title, created_at FROM tasks ORDER BY created_at DESC'
);
```

Or use a thin wrapper if you like the tagged-template style — but `pg` + `pool.query()` is the standard approach.

**`initDb()` on startup** stays the same idea — your API already creates the `tasks` table if missing. No separate migration container required for this simple app.

---

## Volumes — why the database needs one

App containers use **bind mounts** for hot reload (ephemeral, tied to your source code).

Database data must **survive** container restarts. That belongs in a **named volume**:

```yaml
# Inside db service — plug the disk in:
volumes:
  - postgres_data:/var/lib/postgresql/data

# Bottom of compose file — create/register the disk:
volumes:
  postgres_data:
```

### Why two lines for `postgres_data`?

They are a **pair** — not two separate things:

| Line | Role |
|------|------|
| `postgres_data:/var/lib/...` in `db` | **Plug** storage into the container at Postgres's data path |
| `postgres_data:` at bottom | **Create** the Docker-managed disk (not a container — just storage) |

Full explanation with diagrams → **[DOCKER-REFERENCE.md § Volume types](./DOCKER-REFERENCE.md#2-volume-types--bind-anonymous-named)**

| Volume type | Used for | Survives `docker compose down`? |
|-------------|----------|----------------------------------|
| Bind mount `./back:/app` | Live source code | Yes (it's your files) |
| Anonymous `/app/node_modules` | Protect deps | No (removed with container) |
| Named `postgres_data` | Database files | **Yes** (by default) |

### Disk space — is it infinite?

**No.** `postgres_data` grows with your data and is limited by your drive / Docker Desktop disk settings. Details → **[DOCKER-REFERENCE.md § Disk space](./DOCKER-REFERENCE.md#3-disk-space-on-volumes--is-it-infinite)**

### Wiping the database

```bash
docker compose down -v    # -v removes named volumes — deletes all DB data
```

Use only when you want a fresh empty database.

### How many containers and volumes?

With the `db` service you have **3 containers** and **5 mount points** (1 named volume, 2 bind mounts, 2 anonymous volumes). Cheat sheet → **[DOCKER-REFERENCE.md § Container counts](./DOCKER-REFERENCE.md#4-how-many-containers-and-volumes)**

---

## Full architecture diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  YOUR LAPTOP                                                    │
│                                                                 │
│  Browser ──► localhost:5173 ──► client container (Vite/React)   │
│     │                                                           │
│     └──fetch──► localhost:3000 ──► api container (Express)    │
│                                         │                       │
│                                         │ DATABASE_URL          │
│                                         │ @db:5432              │
│                                         ▼                       │
│                                   db container (Postgres)       │
│                                         │                       │
│                                         ▼                       │
│                                   postgres_data (volume)        │
│                                   persists on disk              │
│                                                                 │
│  Optional: DBeaver ──► localhost:5432 ──► db container        │
└─────────────────────────────────────────────────────────────────┘
```

**Frontend never talks to `db`.** Only `api` does. Same as with Neon.

---

## What stays the same

| Piece | Changes? |
|-------|----------|
| `back/Dockerfile` | No |
| `front/Dockerfile` | No |
| `front/vite.config.ts` (`host: true`) | No |
| `.dockerignore` files | No |
| `VITE_API_URL=http://localhost:3000` | No — browser still uses host-mapped ports |
| `CORS_ORIGIN` | No |
| Root `.env` pattern | Yes — different variables |

---

## Run it

```bash
# from repo root
docker compose up --build
```

Startup order:

1. `db` starts → healthcheck passes when Postgres is ready  
2. `api` starts → connects to `db:5432` → runs `initDb()`  
3. `client` starts → React app loads  

Verify:

- App: `http://localhost:5173`
- API health: `http://localhost:3000/api/health` → `"database": "connected"`
- DB (optional): connect GUI to `localhost:5432`

---

## When to use which

| Choose **Neon** when… | Choose **Docker Postgres** when… |
|------------------------|----------------------------------|
| You want zero DB ops | You want everything local / offline |
| You're learning Docker for apps, not DB admin | You're learning volumes, healthchecks, multi-service Compose |
| You deploy to cloud later with a managed DB | You want prod-like local parity with a real Postgres process |
| You want a free hosted DB without running a container | You're okay managing backups and disk yourself |

Many teams use **Docker Postgres for local dev** and **Neon/RDS for production** — same API code if you use `pg` and a standard `DATABASE_URL` everywhere.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `connection refused` to `db` | API started before Postgres ready | Add `healthcheck` + `condition: service_healthy` |
| `password authentication failed` | User/pass mismatch | Align `POSTGRES_*` in `.env` with `DATABASE_URL` |
| Data gone after `docker compose down -v` | `-v` deletes named volumes | Expected; omit `-v` to keep data |
| API works in Docker, fails on host | Wrong host in URL | Use `@db` in container, `@localhost` when API runs on host |
| `@neondatabase/serverless` errors | Driver mismatch | Switch to `pg` for containerized Postgres |
| Port 5432 already in use | Local Postgres installed | Stop local Postgres or change mapping to `"5433:5432"` |

---

## Minimal migration checklist

If you switch this project from Neon to Docker Postgres:

- [ ] Add `db` service + `postgres_data` volume to `docker-compose.yml`
- [ ] Add `healthcheck` on `db` and `depends_on: condition: service_healthy` on `api`
- [ ] Update root `.env` with `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- [ ] Point `DATABASE_URL` at `@db:5432/...` for the API service
- [ ] Replace `@neondatabase/serverless` with `pg` in `back/src/db.ts`
- [ ] Update route queries to use `pool.query()`
- [ ] (Optional) Expose `5432:5432` for GUI tools

---

## Related docs

- **[DOCKERIZATION-WALKTHROUGH.md](./DOCKERIZATION-WALKTHROUGH.md)** — full Docker setup for `api` + `client` (current Neon-based project)
- **[DOCKER-REFERENCE.md](./DOCKER-REFERENCE.md)** — volumes, `up` vs `--build`, disk space, healthchecks, container counts
- **[../README.md](../README.md)** — project overview and run commands
