import { api } from './client'

export const getGanttData = (params?: {
  desde?: string
  hasta?: string
  centros?: string
}) => api.get('/api/gantt', { params }).then(r => r.data)
