import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { sql } from './db.js';

vi.mock('./db.js', () => ({
  sql: vi.fn(),
  initDb: vi.fn(),
}));

describe('API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('returns ok when database is reachable', async () => {
      vi.mocked(sql).mockResolvedValueOnce([{ '?column?': 1 }]);

      const response = await request(createApp()).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', database: 'connected' });
    });

    it('returns 500 when database is down', async () => {
      vi.mocked(sql).mockRejectedValueOnce(new Error('connection refused'));

      const response = await request(createApp()).get('/api/health');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('GET /api/tasks', () => {
    it('returns a list of tasks', async () => {
      const tasks = [
        { id: 1, title: 'Learn Docker', created_at: '2026-07-05T10:00:00.000Z' },
      ];
      vi.mocked(sql).mockResolvedValueOnce(tasks);

      const response = await request(createApp()).get('/api/tasks');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(tasks);
    });
  });

  describe('POST /api/tasks', () => {
    it('creates a task with a valid title', async () => {
      const task = { id: 2, title: 'Set up CI', created_at: '2026-07-05T11:00:00.000Z' };
      vi.mocked(sql).mockResolvedValueOnce([task]);

      const response = await request(createApp())
        .post('/api/tasks')
        .send({ title: 'Set up CI' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(task);
    });

    it('rejects an empty title', async () => {
      const response = await request(createApp())
        .post('/api/tasks')
        .send({ title: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
      expect(sql).not.toHaveBeenCalled();
    });

    it('rejects a missing title', async () => {
      const response = await request(createApp()).post('/api/tasks').send({});

      expect(response.status).toBe(400);
      expect(sql).not.toHaveBeenCalled();
    });
  });
});
