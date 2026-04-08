import { api } from './client'

export const getTickets = (params?: Record<string, unknown>) =>
  api.get('/api/maintenance/tickets', { params }).then(r => r.data)
export const getTicketsActivos = () =>
  api.get('/api/maintenance/tickets/activos').then(r => r.data)
export const getTicket = (id: number) =>
  api.get(`/api/maintenance/tickets/${id}`).then(r => r.data)
export const createTicket = (data: unknown) =>
  api.post('/api/maintenance/tickets', data).then(r => r.data)
export const updateTicket = (id: number, data: unknown) =>
  api.patch(`/api/maintenance/tickets/${id}`, data).then(r => r.data)
export const getBitacora = (id: number) =>
  api.get(`/api/maintenance/tickets/${id}/bitacora`).then(r => r.data)
export const createBitacora = (id: number, data: unknown) =>
  api.post(`/api/maintenance/tickets/${id}/bitacora`, data).then(r => r.data)
export const getRepuestos = (q?: string) =>
  api.get('/api/maintenance/repuestos', { params: q ? { q } : undefined }).then(r => r.data)
export const getCatalogos = () =>
  api.get('/api/maintenance/catalogos').then(r => r.data)
