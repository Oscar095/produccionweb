import { api } from './client'

export const getUsuarios = () => api.get('/api/auth/usuarios').then(r => r.data)
export const createUsuario = (data: unknown) => api.post('/api/auth/usuarios', data).then(r => r.data)
export const updateUsuario = (id: number, data: unknown) =>
  api.patch(`/api/auth/usuarios/${id}`, data).then(r => r.data)
export const deleteUsuario = (id: number) =>
  api.delete(`/api/auth/usuarios/${id}`).then(r => r.data)
export const resetPassword = (id: number, nueva_password: string) =>
  api.post(`/api/auth/usuarios/${id}/reset-password`, { nueva_password }).then(r => r.data)
