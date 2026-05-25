import { api } from './client'

export type KpiKey = 'tasa_servicio' | 'disponibilidad' | 'eficiencia' | 'calidad'

export interface PeriodoIndicador {
  inicio: string
  fin: string
  mes_label: string
}

export interface SemanaValor {
  semana_label: string
  inicio: string
  fin: string
  valor: number
}

export interface MaquinaValor {
  maquina_id: number
  maquina_nombre: string | null
  valor: number
}

export interface IndicadorData {
  kpi: KpiKey
  periodo: PeriodoIndicador
  meta: number | null
  valor_periodo: number
  por_semana: SemanaValor[]
  por_maquina: MaquinaValor[]
}

export const fetchIndicador = (
  kpi: KpiKey,
  mes?: string,
  maquinaId?: number,
): Promise<IndicadorData> => {
  const params: Record<string, string | number> = {}
  if (mes) params.mes = mes
  if (maquinaId != null) params.maquina_id = maquinaId
  return api.get(`/api/indicadores/${kpi}`, { params }).then(r => r.data)
}
