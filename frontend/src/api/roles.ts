import { api } from './client'

export const getRoles = () => api.get('/api/roles').then(r => r.data)
export const getRol = (id: number) => api.get(`/api/roles/${id}`).then(r => r.data)
export const createRol = (data: unknown) => api.post('/api/roles', data).then(r => r.data)
export const updateRol = (id: number, data: unknown) => api.patch(`/api/roles/${id}`, data).then(r => r.data)
export const deleteRol = (id: number) => api.delete(`/api/roles/${id}`).then(r => r.data)
export const updatePermisos = (id: number, permisos: unknown[]) =>
  api.put(`/api/roles/${id}/permisos`, { permisos }).then(r => r.data)
