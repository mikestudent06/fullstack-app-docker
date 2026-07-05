# CI/CD Pipeline

How code goes from your laptop to Docker Hub using GitHub Actions.

**Related docs:**
- [DOCKERIZATION-WALKTHROUGH.md](./DOCKERIZATION-WALKTHROUGH.md) — dev Docker setup
- [DEPLOYMENT.md](./DEPLOYMENT.md) — run production images on a server
- [DOCKER-REFERENCE.md](./DOCKER-REFERENCE.md) — volumes, `up` vs `--build`, etc.

---

## The complete flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│   DEV    │───►│  GITHUB  │───►│    CI    │───►│    CD    │───►│  DEPLOY  │
│  local   │    │   push   │    │  verify  │    │  publish │    │  server  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
 docker compose      PR/main      build/lint      push images     pull & run
 (hot reload)                      docker build    Docker Hub      prod compose
```

| Phase | Where | What happens |
|-------|-------|--------------|
| **Dev** | Your laptop | `docker compose up` — bind mounts, hot reload |
| **CI** | GitHub Actions | Verify code compiles; prod Dockerfiles build |
| **CD** | GitHub Actions | Push production images to Docker Hub |
| **Deploy** | VPS / cloud | Pull images, run `docker-compose.prod.yml` |

---

## Dev vs production Docker

| | Dev (`Dockerfile`) | Prod (`Dockerfile.prod`) |
|---|------------------|--------------------------|
| **API** | `tsx watch` (hot reload) | `node dist/index.js` |
| **Frontend** | Vite dev server | `npm run build` → nginx serves static files |
| **Source code** | Bind mount from laptop | Baked into image |
| **Image size** | Larger (devDependencies) | Slim (production deps only) |
| **Used by** | `docker-compose.yml` | CI/CD + `docker-compose.prod.yml` |

### API production Dockerfile (`back/Dockerfile.prod`)

Two stages:

```
Stage 1 (build):  npm ci → tsc → dist/
Stage 2 (production): npm ci --omit=dev → copy dist/ → node dist/index.js
```

Only the compiled `dist/` folder and production `node_modules` end up in the final image.

### Frontend production Dockerfile (`front/Dockerfile.prod`)

Two stages:

```
Stage 1 (build):  npm ci → vite build → dist/
Stage 2 (production): nginx:alpine serves dist/ on port 80
```

`VITE_API_URL` is passed as a **build argument** — it gets baked into the JavaScript at build time. Change the API URL → rebuild the client image.

---

## GitHub Actions workflows

### `.github/workflows/ci.yml` — Continuous Integration

**Triggers:** every push and pull request to `main`

**Jobs:**

| Job | What it does |
|-----|--------------|
| `backend` | `npm ci` → **`npm test`** → `npm run build` |
| `frontend` | `npm ci` → `npm run lint` → **`npm test`** → `npm run build` |
| `docker-prod-build` | Builds both `Dockerfile.prod` images (no push) |

**Purpose:** catch broken code and failing tests before merge. Also proves production Dockerfiles still build.

Full testing guide → **[TESTING.md](./TESTING.md)**

### `.github/workflows/cd.yml` — Continuous Delivery

**Triggers:**
- After **CI succeeds** on `main` (`workflow_run`)
- Manual (`workflow_dispatch`)

**What it does:**

1. Log in to Docker Hub
2. Build `back/Dockerfile.prod` → push to `youruser/fullstack-app-api`
3. Build `front/Dockerfile.prod` → push to `youruser/fullstack-app-client`

**Image tags:**

| Tag | Example | Purpose |
|-----|---------|---------|
| Git SHA | `a1b2c3d` | Exact version — use for deploys and rollbacks |
| `latest` | `latest` | Most recent `main` build |

CD only runs if CI passed — no broken images published.

---

## GitHub setup (required before CD works)

### 1. Docker Hub account

Create repos (optional — Docker Hub auto-creates on first push):
- `fullstack-app-api`
- `fullstack-app-client`

### 2. Docker Hub access token

Docker Hub → Account Settings → Security → New Access Token

### 3. GitHub repository secrets

Repo → Settings → Secrets and variables → Actions → **Secrets**

| Secret | Value |
|--------|-------|
| `DOCKERHUB_USERNAME` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | Access token (not your password) |

### 4. GitHub repository variable

Repo → Settings → Secrets and variables → Actions → **Variables**

| Variable | Value | Why |
|----------|-------|-----|
| `VITE_API_URL` | Your production API URL | Baked into frontend at CD build time |

Example: `https://api.yourdomain.com` or `http://YOUR_SERVER_IP:3000`

Until this is set, CD still runs but the frontend image may point at an empty API URL.

---

## Files added for CI/CD

```
.github/
  workflows/
    ci.yml                 # verify on every push/PR
    cd.yml                 # push images after CI passes on main

back/
  Dockerfile               # dev (existing)
  Dockerfile.prod          # production multi-stage

front/
  Dockerfile               # dev (existing)
  Dockerfile.prod          # vite build + nginx
  nginx.conf               # SPA routing for React

docker-compose.prod.yml    # run production images
.env.prod.example          # production env template

# Tests (see TESTING.md)
back/src/app.ts            # extracted for testability
back/src/app.test.ts
front/src/api.test.ts
front/src/App.test.tsx
```

Full testing guide → **[TESTING.md](./TESTING.md)**

---

## What runs when you push

### Pull request to `main`

```
push → ci.yml only
  ├── backend build
  ├── frontend lint + build
  └── prod Dockerfile build check
```

No images pushed. Safe for experiments.

### Merge / push to `main`

```
push → ci.yml
  └── (all jobs pass)
        └── cd.yml triggers
              ├── build + push fullstack-app-api:SHA
              ├── build + push fullstack-app-api:latest
              ├── build + push fullstack-app-client:SHA
              └── build + push fullstack-app-client:latest
```

---

## Test production locally (before deploying)

```bash
cp .env.prod.example .env.prod
# Edit .env.prod — DATABASE_URL, CORS_ORIGIN, VITE_API_URL

docker compose -f docker-compose.prod.yml --env-file .env.prod up --build
```

| Service | URL |
|---------|-----|
| Frontend (nginx) | http://localhost:8080 |
| API | http://localhost:3000 |

No bind mounts — behaves like production.

---

## Secrets — where they live

| Secret / config | Local dev | CI | Production server |
|-----------------|-----------|----|--------------------|
| `DATABASE_URL` | `.env` | Not needed for build | `.env.prod` |
| `DOCKERHUB_*` | — | GitHub Secrets | — |
| `VITE_API_URL` | `.env` | GitHub Variable (CD) | Build arg / `.env.prod` |
| `CORS_ORIGIN` | `.env` | — | `.env.prod` |

**Never** commit secrets. **Never** put secrets in Dockerfiles.

---

## Troubleshooting CI/CD

| Issue | Fix |
|-------|-----|
| CD fails on Docker Hub login | Check `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets |
| CD doesn't run | CI must pass on `main` first |
| Frontend can't reach API in prod | Set `VITE_API_URL` GitHub variable before CD build |
| CORS errors in prod | `CORS_ORIGIN` must match prod frontend URL exactly |
| Want to re-run CD without code change | Actions → CD → Run workflow (manual dispatch) |

---

## Next step

→ **[DEPLOYMENT.md](./DEPLOYMENT.md)** — pull images on a server and go live.
