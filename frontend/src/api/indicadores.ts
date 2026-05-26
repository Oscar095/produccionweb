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
  estado?: 'pasada' | 'en_curso' | 'futura'
}

export interface MaquinaValor {
  maquina_id: number
  maquina_nombre: string | null
  valor: number
  // campos detallados opcionales por KPI
  dias_trabajados?: number | null
  horas_disponibles?: number | null
  horas_parada?: number | null
  horas_operativas?: number | null
  capacidad_hora?: number | null
  produccion_real?: number | null
  produccion_teorica?: number | null
  produccion_buena?: number | null
  clase_b?: number | null
  desecho?: number | null
  produccion_total?: number | null
  total_ops?: number | null
  ops_atrasadas?: number | null
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
