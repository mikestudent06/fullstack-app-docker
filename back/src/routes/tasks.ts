import { Router } from 'express';
import { z } from 'zod';
import { sql } from '../db.js';

export const tasksRouter = Router();

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

tasksRouter.get('/', async (_req, res, next) => {
  try {
    const tasks = await sql`
      SELECT id, title, created_at
      FROM tasks
      ORDER BY created_at DESC
    `;
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

tasksRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createTaskSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
      return;
    }

    const [task] = await sql`
      INSERT INTO tasks (title)
      VALUES (${parsed.data.title})
      RETURNING id, title, created_at
    `;

    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
});
