# Docker Reference — Extra Concepts

Supplementary explanations for things that come up after the main walkthrough: volumes, Compose commands, disk space, and how many containers you end up with.

**Related docs:**
- [DOCKERIZATION-WALKTHROUGH.md](./DOCKERIZATION-WALKTHROUGH.md) — main step-by-step guide (Neon setup)
- [POSTGRES-IN-DOCKER.md](./POSTGRES-IN-DOCKER.md) — adding a local Postgres container
- [CI-CD.md](./CI-CD.md) — GitHub Actions pipelines
- [DEPLOYMENT.md](./DEPLOYMENT.md) — production deployment

---

## 1. `docker compose up` vs `docker compose up --build`

Both commands **start** your services. The difference is whether Docker **rebuilds images** first.

### `docker compose up`

```
1. Read docker-compose.yml + .env
2. Do images already exist?
   ├── YES → reuse them (skip build)
   └── NO  → build once
3. Start containers
```

**Use when:** you only edited source code (`.ts`, `.tsx`). Bind mounts sync those live — no rebuild needed.

### `docker compose up --build`

```
1. Read docker-compose.yml + .env
2. Always run docker build (may still use layer cache)
3. Start containers
```

**Use when:** something in the **image recipe** changed:

- `Dockerfile` edited
- `package.json` / `package-lock.json` changed (new dependency)
- Stale `node_modules` inside the image

### Quick comparison

| | `docker compose up` | `docker compose up --build` |
|---|---------------------|------------------------------|
| Rebuilds images? | Only if missing | **Always** |
| Uses build cache? | N/A if skipping | Yes — unchanged layers reused |
| Speed | Faster day-to-day | Slower |
| After `npm install` new pkg | May use stale image | Picks up new deps |

### Rule of thumb

| Change type | Command |
|-------------|---------|
| Code in `src/` | `docker compose up` |
| `Dockerfile` or `package.json` | `docker compose up --build` |
| First time setup | `docker compose up --build` |

---

## 2. Volume types — bind, anonymous, named

Compose uses the word `volumes` in two places. This is the main source of confusion.

### Three volume types in this project

| Type | Example | What it is | Used for |
|------|---------|------------|----------|
| **Bind mount** | `./back:/app` | Live link to a folder on your laptop | Hot reload — source code |
| **Anonymous volume** | `/app/node_modules` | Docker-managed disk, no name | Protect Linux deps from bind mount |
| **Named volume** | `postgres_data:/var/lib/postgresql/data` | Docker-managed disk, with a name | Persist database files |

### Bind mount

```yaml
- ./back:/app
```

Your laptop folder **is** the container folder. Edit a file → container sees it instantly.

### Anonymous volume

```yaml
- /app/node_modules
```

No name on the left. Docker auto-creates a throwaway disk. Protects `/app/node_modules` so the bind mount doesn't overwrite Linux dependencies with your host's (possibly empty or Windows) `node_modules`.

Not declared at the bottom of the compose file.

### Named volume

Two lines work as a **pair**:

```yaml
# Inside db service — the PLUG:
volumes:
  - postgres_data:/var/lib/postgresql/data

# Bottom of compose file — CREATE the disk:
volumes:
  postgres_data:
```

| Part | Role |
|------|------|
| `postgres_data:/var/lib/...` in service | **Connect** storage into the container at that path |
| `postgres_data:` at bottom | **Declare** that a Docker-managed disk named `postgres_data` exists |

**The bottom block is NOT a container.** It's storage — like registering an external hard drive before plugging it in.

```
Bottom of file:     "Create a disk called postgres_data"
Inside db service:  "Plug postgres_data into Postgres at /var/lib/postgresql/data"
```

Compose may auto-create a named volume even without the bottom block, but declaring it explicitly is clearer and lets you add options later.

### What survives `docker compose down`?

| Storage | Survives `down`? | Survives `down -v`? |
|---------|------------------|---------------------|
| Bind mount (`./back`) | Yes (your files) | Yes (your files) |
| Anonymous volume (`node_modules`) | No | No |
| Named volume (`postgres_data`) | **Yes** | **No** — `-v` deletes it |

---

## 3. Disk space on volumes — is it infinite?

**No.** A named volume uses **real disk space** on your machine.

```
postgres_data (Docker volume)
        │
        └── stored in Docker's storage area
                └── on Windows: inside Docker Desktop's VM disk
                        └── which lives on your drive (e.g. C:)
```

### How it grows

| Action | Effect |
|--------|--------|
| Add rows to DB | Volume grows |
| Delete rows | Often doesn't shrink much (Postgres reuses space) |
| Small training app | Megabytes, not gigabytes |

### Limits

Bounded by:

1. Free space on your drive
2. Docker Desktop disk image size (Settings → Resources → Disk image size on Windows)

Running out of space → writes fail, Postgres may refuse to start — same as any disk-full situation.

### Useful commands

```bash
docker volume ls              # list volumes
docker system df              # Docker disk usage overview
docker volume inspect postgres_data
```

**Wipe DB data only:**

```bash
docker compose down -v    # deletes named volumes including postgres_data
```

**Reclaim unused Docker resources (careful):**

```bash
docker system prune       # stopped containers, unused networks
docker system prune -a    # also unused images
```

---

## 4. How many containers and volumes?

### Current setup (Neon — no `db` service)

**Containers: 2**

| Container | Service | Runs |
|-----------|---------|------|
| `task_api` | `api` | Express |
| `task_client` | `client` | Vite + React |

**Storage mount points: 4** (no named volumes)

| Mount | Type | Service |
|-------|------|---------|
| `./back:/app` | Bind | `api` |
| `/app/node_modules` | Anonymous | `api` |
| `./front:/app` | Bind | `client` |
| `/app/node_modules` | Anonymous | `client` |

Database: Neon in the cloud — **not** a container.

---

### With Postgres in Docker (`db` service added)

**Containers: 3**

| Container | Service | Runs |
|-----------|---------|------|
| `task_db` | `db` | Postgres |
| `task_api` | `api` | Express |
| `task_client` | `client` | Vite + React |

**Storage mount points: 5**

| Mount | Type | Service | Purpose |
|-------|------|---------|---------|
| `postgres_data:/var/lib/postgresql/data` | **Named** | `db` | Persist DB files |
| `./back:/app` | Bind | `api` | Hot reload |
| `/app/node_modules` | Anonymous | `api` | Protect deps |
| `./front:/app` | Bind | `client` | Hot reload |
| `/app/node_modules` | Anonymous | `client` | Protect deps |

**Simple count:**

| Category | Count |
|----------|-------|
| Named volumes (declared at bottom) | **1** (`postgres_data`) |
| Anonymous volumes | **2** (one per app service) |
| Bind mounts | **2** (`./back`, `./front`) |

### Visual

```
CONTAINERS (3)                    STORAGE
┌──────────┐                      ┌─────────────────┐
│ task_db  │ ───────────────────► │ postgres_data   │ named
└──────────┘                      └─────────────────┘
┌──────────┐                      ┌─────────────────┐
│ task_api │ ───────────────────► │ ./back + anon   │ bind + anon
└──────────┘                      │ node_modules    │
┌──────────┐                      ┌─────────────────┐
│task_client│ ──────────────────► │ ./front + anon  │ bind + anon
└──────────┘                      │ node_modules    │
```

---

## 5. Healthchecks — what they do

Used when a container needs time to become **ready** (Postgres is the classic example).

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U app -d tasks"]
  interval: 5s
  timeout: 5s
  retries: 5
```

| Key | Meaning |
|-----|---------|
| `test` | Command run **inside** the container. Exit 0 = healthy. |
| `interval: 5s` | Check every 5 seconds |
| `timeout: 5s` | Wait up to 5s per check |
| `retries: 5` | Mark unhealthy after 5 failures |

A container can be **running** but not **healthy** yet (Postgres still starting).

Pair with:

```yaml
api:
  depends_on:
    db:
      condition: service_healthy   # wait until pg_isready passes
```

| `depends_on` variant | Waits for |
|----------------------|-----------|
| `depends_on: - db` | Container to **start** |
| `condition: service_healthy` | App inside to be **ready** |

Without healthcheck, the API often hits `connection refused` on first boot.

---

## Quick lookup

| Question | Answer |
|----------|--------|
| Is `postgres_data:` at bottom a container? | **No** — it's disk storage |
| `up` vs `up --build`? | `--build` rebuilds images first |
| Is volume space infinite? | **No** — uses your disk / Docker Desktop limit |
| How many containers (Neon)? | **2** |
| How many containers (Docker Postgres)? | **3** |
| When to use named volume? | Data that must survive container deletion (DB) |
| When to use bind mount? | Source code you're actively editing |
| When to use anonymous volume? | Protect a path from bind mount overwrite (`node_modules`) |
