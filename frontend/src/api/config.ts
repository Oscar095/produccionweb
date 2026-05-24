import { api } from './client'

export const getMaquinas = () => api.get('/api/config/maquinas').then(r => r.data)
export const createMaquina = (data: unknown) => api.post('/api/config/maquinas', data).then(r => r.data)
export const updateMaquina = (id: number, data: unknown) => api.patch(`/api/config/maquinas/${id}`, data).then(r => r.data)

export const getCentrosCostos = () => api.get('/api/config/centros-costos').then(r => r.data)
export const getEstadosMaquinas = () => api.get('/api/config/estados-maquinas').then(r => r.data)

export const getRutasSiesa = () => api.get('/api/config/rutas-siesa').then(r => r.data)
export const createRutaSiesa = (data: unknown) => api.post('/api/config/rutas-siesa', data).then(r => r.data)
export const updateRutaSiesa = (id: number, data: unknown) => api.patch(`/api/config/rutas-siesa/${id}`, data).then(r => r.data)

export const getMetas = () => api.get('/api/config/metas').then(r => r.data)
export const updateMeta = (kpi: string, valor: number) => api.put(`/api/config/metas/${kpi}`, { valor }).then(r => r.data)
