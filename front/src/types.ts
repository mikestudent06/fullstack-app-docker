export interface Task {
  id: number
  title: string
  created_at: string
}

export interface HealthResponse {
  status: string
  database: string
}
