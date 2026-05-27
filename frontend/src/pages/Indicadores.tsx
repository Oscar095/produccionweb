import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine,
} from 'recharts'
import {
  BarChart3, Target, Gauge, Zap, ShieldCheck, TrendingUp, Layers, Table2,
  type LucideIcon,
} from 'lucide-react'
import { fetchIndicador, type KpiKey, type IndicadorData, type MaquinaValor } from '../api/indicadores'
import { getCenters } from '../api/production'
import CapacidadesPanel from '../components/CapacidadesPanel'

type TabKey = KpiKey | 'capacidad'

type TabDef = {
  key: TabKey
  label: string
  Icon: LucideIcon
  accent: string
  description: string
}

const TABS: TabDef[] = [
  {
    key: 'tasa_servicio',
    label: 'Tasa de Servicio',
    Icon: Target,
    accent: 'text-violet-600 bg-violet-100',
    description: 'OPs entregadas a tiempo / total comprometidas en el mes',
  },
  {
    key: 'disponibilidad',
    label: 'Disponibilidad',
    Icon: Gauge,
    accent: 'text-teal-600 bg-teal-100',
    description: 'Horas operativas (L-V) descontando paradas de mantenimiento',
  },
  {
    key: 'eficiencia',
    label: 'Eficiencia',
    Icon: Zap,
    accent: 'text-orange-600 bg-orange-100',
    description: 'Producción real vs. capacidad nominal × horas operativas',
  },
  {
    key: 'calidad',
    label: 'Calidad',
    Icon: ShieldCheck,
    accent: 'text-cyan-600 bg-cyan-100',
    description: 'Unidades buenas / (buenas + clase B + desecho)',
  },
  {
    key: 'capacidad',
    label: 'Capacidad',
    Icon: Layers,
    accent: 'text-indigo-600 bg-indigo-100',
    description: 'Ocupación de máquinas vs. capacidad teórica por período',
  },
]

function currentMonthString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface MaquinaOpt { Id: number; nombre: string }

function colorForValue(valor: number, meta: number | null | undefined): string {
  const reference = Math.min(Math.max(meta ?? 80, 1), 100)
  if (valor >= reference) return '#10B981'      // emerald
  if (valor >= reference * 0.8) return '#F59E0B' // amber
  return '#F43F5E'                                // rose
}

// ── Columnas por KPI para la tabla detallada ───────────────

type ColDef = {
  key: string
  label: string
  render: (m: MaquinaValor) => string | number
  align?: 'right' | 'left'
}

function getColumns(kpi: KpiKey): ColDef[] {
  if (kpi === 'disponibilidad') return [
    { key: 'dias', label: 'Días', render: m => m.dias_trabajados ?? '—', align: 'right' },
    { key: 'hrs_disp', label: 'Hrs hábiles', render: m => m.horas_disponibles?.toFixed(1) ?? '—', align: 'right' },
    { key: 'hrs_parada', label: 'Hrs parada', render: m => m.horas_parada?.toFixed(1) ?? '—', align: 'right' },
  ]
  if (kpi === 'eficiencia') return [
    { key: 'dias', label: 'Días', render: m => m.dias_trabajados ?? '—', align: 'right' },
    { key: 'cap', label: 'Cap/hora', render: m => m.capacidad_hora ?? '—', align: 'right' },
    { key: 'hrs_op', label: 'Hrs operativas', render: m => m.horas_operativas?.toFixed(1) ?? '—', align: 'right' },
    { key: 'prod_real', label: 'Prod. real', render: m => m.produccion_real?.toLocaleString() ?? '—', align: 'right' },
    { key: 'prod_teo', label: 'Prod. teórica', render: m => m.produccion_teorica?.toFixed(0) ?? '—', align: 'right' },
  ]
  if (kpi === 'calidad') return [
    { key: 'buena', label: 'Buena', render: m => m.produccion_buena?.toLocaleString() ?? '—', align: 'right' },
    { key: 'claseb', label: 'Clase B', render: m => m.clase_b?.toLocaleString() ?? '—', align: 'right' },
    { key: 'desecho', label: 'Desecho', render: m => m.desecho?.toLocaleString() ?? '—', align: 'right' },
    { key: 'total', label: 'Total', render: m => m.produccion_total?.toLocaleString() ?? '—', align: 'right' },
  ]
  // tasa_servicio
  return [
    { key: 'total_ops', label: 'Total OPs', render: m => m.total_ops ?? '—', align: 'right' },
    { key: 'atrasadas', label: 'Atrasadas', render: m => m.ops_atrasadas ?? '—', align: 'right' },
  ]
}

export default function Indicadores() {
  const [activeTab, setActiveTab] = useState<TabKey>('tasa_servicio')
  const [mes, setMes] = useState<string>(currentMonthString())
  const [maquinaId, setMaquinaId] = useState<number | undefined>(undefined)
  const [ytd, setYtd] = useState(false)

  const isKpiTab = activeTab !== 'capacidad'

  const { data: maquinas = [] } = useQuery<MaquinaOpt[]>({
    queryKey: ['centers'],
    queryFn: getCenters,
    staleTime: 600_000,
  })

  const { data, isLoading, isError, error } = useQuery<IndicadorData>({
    queryKey: ['indicador', activeTab, mes, maquinaId, ytd],
    queryFn: () => fetchIndicador(activeTab as KpiKey, mes, maquinaId, ytd),
    placeholderData: keepPreviousData,
    enabled: isKpiTab,
  })

  const tab = TABS.find(t => t.key === activeTab)!

  const deltaMeta = useMemo(() => {
    if (!data || data.meta == null) return null
    return Number((data.valor_periodo - data.meta).toFixed(1))
  }, [data])

  const extraCols = getColumns(activeTab)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Análisis</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Indicadores de Planta</h1>
              <p className="text-blue-200 text-sm mt-1">
                Tasa de Servicio, Disponibilidad, Eficiencia, Calidad y Capacidad — vista mensual, acumulada y por máquina
              </p>
            </div>
            {isKpiTab && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="inline-flex rounded-xl border border-white/20 overflow-hidden bg-white/5 backdrop-blur-sm">
                  <button
                    onClick={() => setYtd(false)}
                    className={`px-3 py-2 text-sm font-medium transition-all ${!ytd ? 'bg-white text-slate-800' : 'text-white hover:bg-white/10'}`}
                  >
                    Mensual
                  </button>
                  <button
                    onClick={() => setYtd(true)}
                    className={`px-3 py-2 text-sm font-medium transition-all ${ytd ? 'bg-white text-slate-800' : 'text-white hover:bg-white/10'}`}
                  >
                    Acumulado
                  </button>
                </div>
                <label className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-sm rounded-xl text-white text-sm">
                  <span className="text-blue-200 text-xs uppercase tracking-wide">Mes</span>
                  <input
                    type="month"
                    value={mes}
                    onChange={e => setMes(e.target.value)}
                    className="bg-transparent text-white text-sm outline-none [color-scheme:dark]"
                  />
                </label>
                <label className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-sm rounded-xl text-white text-sm">
                  <span className="text-blue-200 text-xs uppercase tracking-wide">Máquina</span>
                  <select
                    value={maquinaId ?? ''}
                    onChange={e => setMaquinaId(e.target.value ? Number(e.target.value) : undefined)}
                    className="bg-transparent text-white text-sm outline-none [color-scheme:dark]"
                  >
                    <option value="" className="text-slate-800">Todas</option>
                    {maquinas.filter(m => m.Id !== 0).map(m => (
                      <option key={m.Id} value={m.Id} className="text-slate-800">{m.nombre}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">
        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-2 flex gap-2 flex-wrap">
          {TABS.map(t => {
            const active = t.key === activeTab
            const Icon = t.Icon
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Panel Capacidad */}
        {!isKpiTab && <CapacidadesPanel cursorInicial={new Date()} />}

        {/* KPI sections — solo cuando NO es capacidad */}
        {isKpiTab && <>

        {/* Error / Loading */}
        {isError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl p-5 text-sm">
            Error cargando datos: {(error as Error)?.message ?? 'desconocido'}
          </div>
        )}

        {/* Sección 1: KPI grande */}
        <div className="rounded-2xl shadow-sm p-6 bg-gradient-to-br from-slate-50 via-white to-slate-50 border border-slate-100">
          <div className="flex items-center gap-4 flex-wrap">
            <div className={`flex-shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center ${tab.accent}`}>
              <tab.Icon size={32} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                {tab.label} · {data?.periodo.mes_label ?? '—'}
              </p>
              {isLoading ? (
                <div className="h-12 w-36 bg-slate-200 animate-pulse rounded-lg mt-1" />
              ) : (
                <p className="text-5xl font-bold text-slate-800 leading-tight mt-1">
                  {`${data?.valor_periodo ?? 0}%`}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-1">{tab.description}</p>
            </div>
            {isLoading ? (
              <div className="text-right space-y-1">
                <div className="h-3 w-12 bg-slate-200 animate-pulse rounded ml-auto" />
                <div className="h-7 w-20 bg-slate-200 animate-pulse rounded ml-auto" />
              </div>
            ) : data?.meta != null && (
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Meta</p>
                <p className="text-2xl font-bold text-slate-700">{data.meta.toFixed(1)}%</p>
                {deltaMeta != null && (
                  <p className={`text-xs mt-1 font-semibold flex items-center justify-end gap-1 ${
                    deltaMeta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    <TrendingUp size={12} className={deltaMeta < 0 ? 'rotate-180' : ''} />
                    {deltaMeta >= 0 ? '+' : ''}{deltaMeta} pts vs meta
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sección 2: Por semana / Por mes (YTD) */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={15} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
              {ytd ? 'Por mes (acumulado)' : 'Por semana del mes'}
            </span>
            <span className="ml-auto text-xs text-slate-400">
              {ytd ? `${data?.por_semana.length ?? 0} meses` : `${data?.por_semana.length ?? 0} semanas`}
            </span>
          </div>
          {isLoading ? (
            <div className="flex items-end gap-3 h-[300px] px-4 pb-2">
              {[70, 85, 60, 90, 75].map((h, i) => (
                <div key={i} className="flex-1 bg-slate-200 animate-pulse rounded-t-md" style={{ height: `${h}%` }} />
              ))}
            </div>
          ) : data && data.por_semana.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.por_semana} margin={{ left: 0, right: 10 }}>
                <XAxis dataKey="semana_label" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#64748b' }} domain={[0, 100]} />
                <Tooltip
                  formatter={(val: unknown) => [`${(val as number).toFixed(1)}%`, tab.label]}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    fontSize: '12px',
                  }}
                />
                {data.meta != null && (
                  <ReferenceLine y={data.meta} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `Meta ${data.meta}%`, position: 'right', fontSize: 10, fill: '#64748b' }} />
                )}
                <Bar dataKey="valor" radius={[6, 6, 0, 0]}>
                  {data.por_semana.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.estado === 'futura' ? '#cbd5e1' : colorForValue(entry.valor, data.meta)}
                      opacity={entry.estado === 'futura' ? 0.7 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-slate-400 text-sm">
              Sin datos para este período.
            </div>
          )}
          {data && data.por_semana.some(s => s.estado === 'futura') && (
            <p className="text-xs text-slate-400 mt-2 text-right">
              Barras grises = semanas futuras (proyección)
            </p>
          )}
        </div>

        {/* Sección 3: Por máquina — gráfico */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Gauge size={15} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
              Por máquina · {data?.periodo.mes_label ?? '—'}
            </span>
            <span className="ml-auto text-xs text-slate-400">
              {data?.por_maquina.length ?? 0} máquinas
            </span>
          </div>
          {isLoading ? (
            <div className="space-y-2 px-2 py-4">
              {[80, 65, 90, 45, 72].map((w, i) => (
                <div key={i} className="flex gap-3 items-center">
                  <div className="h-3 w-24 bg-slate-200 animate-pulse rounded" />
                  <div className="h-5 bg-slate-200 animate-pulse rounded" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          ) : data && data.por_maquina.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(300, data.por_maquina.length * 32)}>
              <BarChart
                data={[...data.por_maquina].sort((a, b) => b.valor - a.valor)}
                layout="vertical"
                margin={{ left: 30, right: 30, top: 8, bottom: 8 }}
              >
                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis
                  type="category"
                  dataKey="maquina_nombre"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  width={120}
                />
                <Tooltip
                  formatter={(val: unknown) => [`${(val as number).toFixed(1)}%`, tab.label]}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    fontSize: '12px',
                  }}
                />
                {data.meta != null && (
                  <ReferenceLine x={data.meta} stroke="#94a3b8" strokeDasharray="4 4" />
                )}
                <Bar dataKey="valor" radius={[0, 6, 6, 0]}>
                  {[...data.por_maquina].sort((a, b) => b.valor - a.valor).map((entry, i) => (
                    <Cell key={i} fill={colorForValue(entry.valor, data.meta)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-slate-400 text-sm">
              Sin datos para este período.
            </div>
          )}
          {!isLoading && (
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-500" />
                <span>≥ meta</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-500" />
                <span>80% – &lt;100% meta</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-rose-500" />
                <span>&lt; 80% meta</span>
              </div>
            </div>
          )}
        </div>

        {/* Sección 4: Tabla detallada por máquina */}
        {!isLoading && data && data.por_maquina.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Table2 size={15} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
                Detalle por máquina
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Máquina</th>
                    {extraCols.map(c => (
                      <th key={c.key} className={`py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                        {c.label}
                      </th>
                    ))}
                    <th className="text-right py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">%</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.por_maquina].sort((a, b) => a.valor - b.valor).map((m, i) => {
                    const color = colorForValue(m.valor, data.meta)
                    const isSinAsignar = m.maquina_id === 0
                    return (
                      <tr
                        key={m.maquina_id}
                        className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${isSinAsignar ? 'bg-slate-50/60' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}
                      >
                        <td className={`py-2.5 px-3 font-medium text-slate-700 ${isSinAsignar ? 'italic text-slate-400' : ''}`}>
                          {m.maquina_nombre ?? `#${m.maquina_id}`}
                        </td>
                        {extraCols.map(c => (
                          <td key={c.key} className={`py-2.5 px-3 text-slate-600 tabular-nums ${c.align === 'right' ? 'text-right' : ''}`}>
                            {c.render(m)}
                          </td>
                        ))}
                        <td className="py-2.5 px-3 text-right font-semibold tabular-nums" style={{ color }}>
                          {m.valor.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ backgroundColor: `${color}20`, color }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                            {color === '#10B981' ? 'Verde' : color === '#F59E0B' ? 'Amarillo' : 'Rojo'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {activeTab === 'tasa_servicio' && data.por_maquina.some(m => m.maquina_id === 0) && (
              <p className="text-xs text-slate-400 mt-3 italic">
                * "Sin asignar": OPs del mes sin asignación a ninguna máquina. La suma por máquina puede superar el total mensual si una OP tiene asignaciones múltiples.
              </p>
            )}
          </div>
        )}
        </>}
      </div>
    </div>
  )
}
