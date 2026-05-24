import { api } from './client'

export const getKPIs = () => api.get('/api/production/kpis').then(r => r.data)
export const getEquipmentAvailability = () =>
  api.get('/api/production/equipment-availability').then(r => r.data)
export const getEquipmentEfficiency = () =>
  api.get('/api/production/equipment-efficiency').then(r => r.data)
export const getEquipmentQuality = () =>
  api.get('/api/production/equipment-quality').then(r => r.data)
export const getEquipmentOEE = () =>
  api.get('/api/production/equipment-oee').then(r => r.data)
export const getOrders = (params?: Record<string, unknown>) =>
  api.get('/api/production/orders', { params }).then(r => r.data)
export const getOrder = (docto: number) =>
  api.get(`/api/production/orders/${docto}`).then(r => r.data)
export const getCenters = () => api.get('/api/production/centers').then(r => r.data)
export const getOperarios = (params?: { cargo?: number; mecanicos_only?: boolean }) =>
  api.get('/api/production/operarios', { params }).then(r => r.data)
export const getRegistros = (params?: Record<string, unknown>) =>
  api.get('/api/production/registros', { params }).then(r => r.data)
export const createRegistro = (data: unknown) =>
  api.post('/api/production/registros', data).then(r => r.data)
