import { useEffect, useState } from 'react'
import { createTask, getHealth, getTasks } from './api'
import type { Task } from './types'
import './App.css'

function App() {
  const [health, setHealth] = useState<string>('checking...')
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadData() {
    setError(null)
    setLoading(true)

    try {
      const [healthResponse, taskList] = await Promise.all([getHealth(), getTasks()])
      setHealth(`${healthResponse.status} · ${healthResponse.database}`)
      setTasks(taskList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) return

    setError(null)

    try {
      const task = await createTask(title.trim())
      setTasks((current) => [task, ...current])
      setTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task')
    }
  }

  return (
    <main className="app">
      <header>
        <p className="eyebrow">DevOps training app</p>
        <h1>Tasks</h1>
        <p className="subtitle">React + Vite frontend talking to a Node API on Neon Postgres.</p>
      </header>

      <section className="panel">
        <div className="status">
          <span>API health</span>
          <strong>{health}</strong>
        </div>

        {error && <p className="error">{error}</p>}

        <form onSubmit={handleSubmit} className="task-form">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task"
            maxLength={200}
            aria-label="Task title"
          />
          <button type="submit">Add</button>
        </form>

        {loading ? (
          <p className="muted">Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <p className="muted">No tasks yet. Add one above.</p>
        ) : (
          <ul className="task-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <span>{task.title}</span>
                <time dateTime={task.created_at}>
                  {new Date(task.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default App
