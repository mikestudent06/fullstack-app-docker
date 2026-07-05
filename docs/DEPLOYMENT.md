# Deployment Guide

How to run the production images published by CI/CD.

**Prerequisites:**
- CD pipeline has pushed images to Docker Hub → see [CI-CD.md](./CI-CD.md)
- Neon database (or other Postgres) with connection string ready

---

## What "deploy" means here

```
Docker Hub (registry)              Your server
┌─────────────────────┐           ┌─────────────────────┐
│ fullstack-app-api   │  docker   │  prod_api container │
│ fullstack-app-client│  pull     │  prod_client (nginx)│
└─────────────────────┘  ───────►  └──────────┬──────────┘
                                              │
                                              ▼
                                         Neon Postgres
```

You don't deploy "to Docker Hub" — Docker Hub **stores** images. Your **server pulls and runs** them.

---

## Option A — VPS / any Linux server (recommended for learning)

Classic DevOps: SSH into a server, install Docker, pull images, run Compose.

### 1. Server requirements

- Linux VPS (Ubuntu 22.04+ works well)
- Docker + Docker Compose plugin installed
- Ports `3000` and `8080` open (or 80/443 with a reverse proxy later)

### 2. Install Docker on the server

```bash
# Ubuntu — official Docker install script
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in
```

### 3. Copy production config to the server

Only these files are needed on the server (not the full repo):

```
docker-compose.prod.yml
.env.prod
```

```bash
# From your laptop
scp docker-compose.prod.yml .env.prod user@YOUR_SERVER_IP:~/
```

### 4. Configure `.env.prod` on the server

```env
DOCKERHUB_USERNAME=your-dockerhub-username
IMAGE_TAG=a1b2c3d          # git SHA from CD — or "latest"

DATABASE_URL=postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require

# Use your server's public IP or domain
CORS_ORIGIN=http://YOUR_SERVER_IP:8080
VITE_API_URL=http://YOUR_SERVER_IP:3000

API_PORT=3000
CLIENT_PORT=8080
```

**Important:** `VITE_API_URL` in `.env.prod` only matters if you **build** on the server. If you pull a pre-built image from CD, the API URL was baked in at CI time via the GitHub `VITE_API_URL` variable. Set that variable to your production API URL **before** CD runs.

### 5. Pull and run

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 6. Verify

```bash
docker compose -f docker-compose.prod.yml ps
curl http://localhost:3000/api/health
```

Open `http://YOUR_SERVER_IP:8080` in your browser.

### 7. Update to a new version

After CD pushes a new image:

```bash
# On the server — update IMAGE_TAG in .env.prod to new SHA, or use latest
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 8. Rollback

```bash
# Set IMAGE_TAG to previous working SHA in .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

This is why we tag images with git SHA — precise rollbacks.

---

## Option B — Test production on your laptop first

Before touching a server:

```bash
cp .env.prod.example .env.prod
# Fill in DATABASE_URL, set URLs to localhost

docker compose -f docker-compose.prod.yml --env-file .env.prod up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| API | http://localhost:3000 |

`--build` builds locally instead of pulling from Docker Hub. Good for validating prod Dockerfiles.

---

## Option C — Platform deploy (Render, Railway, Fly.io)

These platforms can run Docker images without managing a VPS.

### General pattern

1. Connect GitHub repo **or** provide Docker Hub image URL
2. Set environment variables (`DATABASE_URL`, `CORS_ORIGIN`, `PORT`)
3. Platform builds or pulls image and runs it

### Two-service setup

You need **two services** (API + frontend) — same as Compose:

| Service | Image | Port | Env vars |
|---------|-------|------|----------|
| API | `you/fullstack-app-api:latest` | 3000 | `DATABASE_URL`, `CORS_ORIGIN`, `PORT` |
| Frontend | `you/fullstack-app-client:latest` | 80 | (API URL baked in at build) |

Set GitHub `VITE_API_URL` to the API service's public URL **before** CD builds the client image.

### Render example (outline)

1. Create **Web Service** for API → Deploy from Docker Hub image
2. Create **Web Service** for client → Deploy from Docker Hub image
3. Set `CORS_ORIGIN` on API to the client service URL
4. Re-run CD with `VITE_API_URL` = API service URL (rebuilds client)

Platforms vary — check their Docker deploy docs. The env var principles stay the same.

---

## Production networking recap

```
Browser
   │
   ├── loads page from ──► http://SERVER:8080  (nginx / client)
   │
   └── fetch API ────────► http://SERVER:3000  (Express / api)
                                │
                                └──► Neon (DATABASE_URL)
```

| Variable | Must point to |
|----------|---------------|
| `VITE_API_URL` (build time) | Public API URL the **browser** can reach |
| `CORS_ORIGIN` (runtime) | Public frontend URL the **browser** loads from |
| `DATABASE_URL` (runtime) | Neon connection string (API only) |

---

## `docker-compose.prod.yml` explained

```yaml
services:
  api:
    image: ${DOCKERHUB_USERNAME}/fullstack-app-api:${IMAGE_TAG:-latest}
    build: ...            # used when building locally with --build
    environment: ...      # runtime secrets
    restart: unless-stopped

  client:
    image: ${DOCKERHUB_USERNAME}/fullstack-app-client:${IMAGE_TAG:-latest}
    build:
      args:
        VITE_API_URL: ${VITE_API_URL}   # used when building locally
    ports:
      - "8080:80"         # nginx listens on 80 inside container
```

| Key | Dev compose | Prod compose |
|-----|-------------|--------------|
| Volumes | Bind mounts (hot reload) | None — code in image |
| Commands | `npm run dev` | `node dist/index.js` / nginx |
| Images | Built locally | Pulled from Docker Hub |
| Restart | No | `unless-stopped` |

---

## HTTPS / custom domain (later)

For a real deployment you'll add:

1. Domain pointing to your server
2. Reverse proxy (Caddy, nginx, Traefik) terminating SSL
3. Update `CORS_ORIGIN` and `VITE_API_URL` to `https://` URLs
4. Rebuild client image with new `VITE_API_URL`

Out of scope for the initial training setup — but the flow is: update vars → re-run CD → pull on server.

---

## Server commands cheat sheet

```bash
# Start
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Logs
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml logs -f api

# Stop
docker compose -f docker-compose.prod.yml down

# Update images
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# Status
docker compose -f docker-compose.prod.yml ps
```

---

## Checklist — go live

- [ ] CI passes on `main`
- [ ] GitHub Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
- [ ] GitHub Variable: `VITE_API_URL` = production API URL
- [ ] CD pushed images to Docker Hub (check hub.docker.com)
- [ ] Server has Docker installed
- [ ] `.env.prod` on server with `DATABASE_URL`, `CORS_ORIGIN`, `IMAGE_TAG`
- [ ] `docker compose pull && up -d` on server
- [ ] Health check: `/api/health` returns `ok · connected`
- [ ] Browser: frontend loads and tasks work

---

## Related docs

- [CI-CD.md](./CI-CD.md) — pipelines and GitHub setup
- [DOCKERIZATION-WALKTHROUGH.md](./DOCKERIZATION-WALKTHROUGH.md) — dev Docker
- [DOCKER-REFERENCE.md](./DOCKER-REFERENCE.md) — volumes, commands
