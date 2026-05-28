import { api } from './client'

export const getGanttData = (params?: {
  desde?: string
  hasta?: string
  centros?: string
}) => api.get('/api/gantt', { params }).then(r => r.data)


export type CapacidadMaquinaItem = {
  maquina_id: number
  maquina_nombre: string
  centro_costos: string | null
  rutas_siesa_id: number | null
  rutas_siesa_nombre: string | null
  capacidad_hora: number
  horas_disponibles: number
  unidades_teoricas: number
  unidades_producidas: number
  ocupacion_pct: number
}

export type CapacidadTendenciaPunto = {
  bucket: string
  bucket_inicio: string
  bucket_fin: string
  maquina_id: number
  ocupacion_pct: number
}

export type CapacidadesDataOut = {
  desde: string
  hasta: string
  horas_disponibles_periodo: number
  maquinas: CapacidadMaquinaItem[]
  tendencia_mensual: CapacidadTendenciaPunto[]
}

export const getCapacidadesData = (params: { desde: string; hasta: string }) =>
  api.get<CapacidadesDataOut>('/api/gantt/capacidades', { params }).then(r => r.data)
