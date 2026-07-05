import type { HealthResponse, Task } from './types'

const apiBase = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const message = typeof body.error === 'string' ? body.error : response.statusText
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health')
}

export function getTasks(): Promise<Task[]> {
  return request<Task[]>('/api/tasks')
}

export function createTask(title: string): Promise<Task> {
  return request<Task>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}
