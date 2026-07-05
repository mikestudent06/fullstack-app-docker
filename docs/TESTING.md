# Testing Guide

How tests are set up in this project and how they fit into CI.

**Related:** [CI-CD.md](./CI-CD.md) — tests run automatically on every push and PR.

---

## Overview

| Layer | Framework | What we test |
|-------|-----------|--------------|
| **Backend** | Vitest + Supertest | API routes (mocked DB) |
| **Frontend** | Vitest + Testing Library | API client + React UI |

Tests use **mocks** — no real Neon database or running server required. Fast and reliable in CI.

---

## Run tests locally

```bash
# Backend
cd back
npm test              # run once
npm run test:watch    # watch mode

# Frontend
cd front
npm test
npm run test:watch
```

---

## Backend tests

### Structure

```
back/
├── src/
│   ├── app.ts          ← Express app factory (testable)
│   ├── app.test.ts     ← API integration tests
│   ├── index.ts        ← starts server (not tested directly)
│   └── db.ts
└── vitest.config.ts
```

### Why `app.ts` was extracted

`index.ts` calls `app.listen()` and connects to Neon. Tests need the Express app **without** starting a server or hitting a real DB.

```ts
// app.ts — exportable, no listen()
export function createApp(): express.Application { ... }

// index.ts — production entry point
const app = createApp();
app.listen(port);
```

### Mocking the database

```ts
vi.mock('./db.js', () => ({
  sql: vi.fn(),
  initDb: vi.fn(),
}));
```

The Neon `sql` tagged template is mocked. Each test controls what the "database" returns:

```ts
vi.mocked(sql).mockResolvedValueOnce([{ id: 1, title: 'Learn Docker', ... }]);
```

### What's covered

| Test | Endpoint | Asserts |
|------|----------|---------|
| Health OK | `GET /api/health` | 200 + `{ status: 'ok', database: 'connected' }` |
| Health fail | `GET /api/health` | 500 when DB throws |
| List tasks | `GET /api/tasks` | Returns task array |
| Create task | `POST /api/tasks` | 201 + created task |
| Validation | `POST /api/tasks` | 400 for empty/missing title |

---

## Frontend tests

### Structure

```
front/
├── src/
│   ├── api.ts
│   ├── api.test.ts       ← fetch client tests
│   ├── App.tsx
│   ├── App.test.tsx      ← component tests
│   └── test/
│       └── setup.ts      ← jest-dom matchers + cleanup
└── vitest.config.ts
```

### API client tests (`api.test.ts`)

Mocks `global.fetch` — no real HTTP:

```ts
vi.stubGlobal('fetch', vi.fn());
vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ... }) });
```

Tests: successful responses, error handling, correct POST body.

`VITE_API_URL` is set to `''` in `vitest.config.ts` so tests use relative paths (`/api/health`).

### Component tests (`App.test.tsx`)

Mocks the `./api` module — no fetch, no backend:

```ts
vi.mock('./api', () => ({
  getHealth: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
}));
```

Uses **@testing-library/react** to render the UI and **@testing-library/user-event** to simulate typing and clicking.

### What's covered

| Test | Asserts |
|------|---------|
| Health display | Shows `ok · connected` after load |
| Empty state | Shows "No tasks yet" message |
| Add task | Form submission calls API and shows new task |

### Test cleanup

`src/test/setup.ts` runs `cleanup()` after each test so multiple `render()` calls don't leak DOM nodes between tests.

---

## CI integration

In `.github/workflows/ci.yml`:

```yaml
# Backend job
- run: npm run test
- run: npm run build

# Frontend job
- run: npm run lint
- run: npm run test
- run: npm run build
```

**Order matters:** test before build. If tests fail, CI fails and CD does not run.

```
push/PR → CI (test + build) → CD (only if CI passed on main)
```

---

## Adding new tests

### Backend — new route

1. Add handler in `routes/`
2. In `app.test.ts`, mock `sql` return value
3. `request(createApp()).get('/api/...')` and assert status + body

### Frontend — new component

1. Create `Component.test.tsx` next to the component
2. Mock `./api` or `fetch` as needed
3. `render(<Component />)` + `screen.getBy...` assertions

### Guidelines

- **Mock external deps** (DB, fetch) — unit/integration tests should not need Docker or Neon
- **Test behavior, not implementation** — assert what the user sees or what the API returns
- **Keep tests fast** — no `sleep`, no real network

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `fetch` called with full URL in test | Set `VITE_API_URL: ''` in `vitest.config.ts` |
| Multiple elements found | Add `cleanup()` in `setup.ts` afterEach |
| Backend test hits real DB | Ensure `vi.mock('./db.js')` is at top of test file |
| `supertest` import error | Install `@types/supertest` |

---

## Related docs

- [CI-CD.md](./CI-CD.md) — full pipeline
- [DEPLOYMENT.md](./DEPLOYMENT.md) — production deploy
- [DOCKER-REFERENCE.md](./DOCKER-REFERENCE.md) — Docker concepts
