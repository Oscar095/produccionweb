import { api } from './client'

export const getBoard = (params?: { maquina_id?: number }) =>
  api.get('/api/planning/board', { params }).then(r => r.data)

export const getCapacidad = (semana?: string) =>
  api.get('/api/planning/capacidad', { params: semana ? { semana } : undefined }).then(r => r.data)

export const getFeasibility = (maquina_id: number, semana?: string) =>
  api.get(`/api/planning/feasibility/${maquina_id}`, { params: semana ? { semana } : undefined }).then(r => r.data)

export const createAsignacion = (data: unknown) =>
  api.post('/api/planning/asignaciones', data).then(r => r.data)

export const updateAsignacion = (id: number, data: unknown) =>
  api.patch(`/api/planning/asignaciones/${id}`, data).then(r => r.data)

export const bulkPrioridades = (items: Array<{ asignacion_id: number; prioridad: number }>) =>
  api.patch('/api/planning/prioridades', items).then(r => r.data)

export const reordenarPorFecha = (maquina_id: number) =>
  api.post(`/api/planning/asignaciones/reordenar-por-fecha/${maquina_id}`).then(r => r.data)

export const suspenderOrden = (id: number, motivo: string) =>
  api.patch(`/api/planning/asignaciones/${id}/suspender`, { motivo }).then(r => r.data)

export const reactivarOrden = (id: number) =>
  api.patch(`/api/planning/asignaciones/${id}/reactivar`).then(r => r.data)

export const getTimeline = () =>
  api.get('/api/planning/timeline').then(r => r.data)

export const createParada = (data: unknown) =>
  api.post('/api/planning/paradas', data).then(r => r.data)

export const deleteParada = (id: number) =>
  api.delete(`/api/planning/paradas/${id}`).then(r => r.data)
