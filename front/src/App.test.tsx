import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as api from './api'

vi.mock('./api', () => ({
  getHealth: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
}))

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getHealth).mockResolvedValue({ status: 'ok', database: 'connected' })
    vi.mocked(api.getTasks).mockResolvedValue([])
  })

  it('shows API health after loading', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('ok · connected')).toBeInTheDocument()
    })
  })

  it('shows an empty state when there are no tasks', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('No tasks yet. Add one above.')).toBeInTheDocument()
    })
  })

  it('adds a task when the form is submitted', async () => {
    const user = userEvent.setup()
    const newTask = {
      id: 1,
      title: 'Write tests',
      created_at: '2026-07-05T12:00:00.000Z',
    }
    vi.mocked(api.createTask).mockResolvedValueOnce(newTask)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('No tasks yet. Add one above.')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('Task title'), 'Write tests')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(screen.getByText('Write tests')).toBeInTheDocument()
    })
    expect(api.createTask).toHaveBeenCalledWith('Write tests')
  })
})
