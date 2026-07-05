import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTask, getHealth, getTasks } from './api'

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('getHealth returns the health payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok', database: 'connected' }),
    } as Response)

    await expect(getHealth()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    })
  })

  it('getTasks returns the task list', async () => {
    const tasks = [{ id: 1, title: 'Test', created_at: '2026-07-05T10:00:00.000Z' }]
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => tasks,
    } as Response)

    await expect(getTasks()).resolves.toEqual(tasks)
  })

  it('createTask sends a POST with the title', async () => {
    const task = { id: 2, title: 'New task', created_at: '2026-07-05T11:00:00.000Z' }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => task,
    } as Response)

    await expect(createTask('New task')).resolves.toEqual(task)
    expect(fetch).toHaveBeenCalledWith('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New task' }),
    })
  })

  it('throws when the API returns an error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'Invalid input' }),
    } as Response)

    await expect(getHealth()).rejects.toThrow('Invalid input')
  })
})
