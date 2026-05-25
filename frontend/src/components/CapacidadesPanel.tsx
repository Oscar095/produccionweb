import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  format, startOfYear, startOfMonth, endOfMonth, startOfWeek,
  addDays, addMonths, subMonths, addWeeks, subWeeks,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import {
  Gauge, TrendingUp, TrendingDown, Factory, ChevronLeft, ChevronRight, Calendar,
} from 'lucide-react'
import {
  getCapacidadesData,
  type CapacidadMaquinaItem,
  type CapacidadTendenciaPunto,
} from '../api/gantt'
import Loading from './Loading'

type PeriodMode = 'ytd' | 'mes' | 'semana' | 'rango'

const fmtUnidades = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

const ocupacionColor = (pct: number): { bar: string; text: string; bg: string } => {
  if (pct >= 90) return { bar: 'bg-red-500',    text: 'text-red-700',    bg: 'bg-red-50'    }
  if (pct >= 70) return { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' }
  if (pct >= 40) return { bar: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50'   }
  return            { bar: 'bg-slate-400',  text: 'text-slate-600',  bg: 'bg-slate-50'  }
}

// Paleta para líneas del gráfico (cíclica)
const LINE_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#84CC16', '#6366F1',
]

function KpiCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  accent: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-sm p-5 flex gap-4 items-start">
      <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${accent}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-slate-800 leading-tight mt-0.5 truncate" title={String(value)}>
          {value}
        </p>
        {sub && <p className="text-xs text-slate-400 mt-0.5 truncate" title={sub}>{sub}</p>}
      </div>
      <div className={`absolute -right-4 -bottom-4 w-20 h-20 rounded-full opacity-10 ${accent}`} />
    </div>
  )
}

export default function CapacidadesPanel({ cursorInicial }: { cursorInicial: Date }) {
  const [period, setPeriod] = useState<PeriodMode>('mes')
  const [cursor, setCursor] = useState<Date>(cursorInicial)
  const [rangoDesde, setRangoDesde] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [rangoHasta, setRangoHasta] = useState<string>(format(new Date(), 'yyyy-MM-dd'))

  // Top N seleccionables para el gráfico (evita saturar si hay muchas máquinas)
  const [maquinasSeleccionadas, setMaquinasSeleccionadas] = useState<Set<number> | null>(null)

  const { desde, hasta, labelPeriodo } = useMemo(() => {
    const ahora = new Date()
    if (period === 'ytd') {
      const ini = startOfYear(ahora)
      return {
        desde: format(ini, "yyyy-MM-dd'T'00:00:00"),
        hasta: format(ahora, "yyyy-MM-dd'T'23:59:59"),
        labelPeriodo: `Año ${ini.getFullYear()} a la fecha`,
      }
    }
    if (period === 'mes') {
      const ini = startOfMonth(cursor)
      const fin = endOfMonth(cursor)
      return {
        desde: format(ini, "yyyy-MM-dd'T'00:00:00"),
        hasta: format(fin, "yyyy-MM-dd'T'23:59:59"),
        labelPeriodo: format(ini, "MMMM 'de' yyyy", { locale: es }),
      }
    }
    if (period === 'semana') {
      const ini = startOfWeek(cursor, { weekStartsOn: 1 })
      const fin = addDays(ini, 6)
      return {
        desde: format(ini, "yyyy-MM-dd'T'00:00:00"),
        hasta: format(fin, "yyyy-MM-dd'T'23:59:59"),
        labelPeriodo: `Semana del ${format(ini, 'dd/MM', { locale: es })} al ${format(fin, 'dd/MM/yyyy', { locale: es })}`,
      }
    }
    // rango
    return {
      desde: `${rangoDesde}T00:00:00`,
      hasta: `${rangoHasta}T23:59:59`,
      labelPeriodo: `${rangoDesde} → ${rangoHasta}`,
    }
  }, [period, cursor, rangoDesde, rangoHasta])

  const { data, isLoading } = useQuery({
    queryKey: ['gantt-capacidades', desde, hasta],
    queryFn: () => getCapacidadesData({ desde, hasta }),
  })

  const maquinas: CapacidadMaquinaItem[] = data?.maquinas ?? []
  const tendencia: CapacidadTendenciaPunto[] = data?.tendencia_mensual ?? []

  const stats = useMemo(() => {
    if (maquinas.length === 0) return null
    const validas = maquinas.filter(m => m.unidades_teoricas > 0)
    const promedio = validas.length
      ? validas.reduce((acc, m) => acc + m.ocupacion_pct, 0) / validas.length
      : 0
    const maxOcup = validas.reduce<CapacidadMaquinaItem | null>(
      (acc, m) => (!acc || m.ocupacion_pct > acc.ocupacion_pct ? m : acc), null
    )
    const minOcup = validas.reduce<CapacidadMaquinaItem | null>(
      (acc, m) => (!acc || m.ocupacion_pct < acc.ocupacion_pct ? m : acc), null
    )
    const totalProducidas = maquinas.reduce((a, m) => a + m.unidades_producidas, 0)
    const totalTeoricas = maquinas.reduce((a, m) => a + m.unidades_teoricas, 0)
    return { promedio, maxOcup, minOcup, totalProducidas, totalTeoricas }
  }, [maquinas])

  // Dataset para el gráfico: una fila por mes; columnas dinámicas por máquina.
  const { tendenciaRows, maquinasGrafico } = useMemo(() => {
    if (maquinas.length === 0 || tendencia.length === 0) {
      return { tendenciaRows: [], maquinasGrafico: [] as CapacidadMaquinaItem[] }
    }
    // Top 8 por ocupación si no hay selección manual.
    const seleccionadas = maquinasSeleccionadas
      ? maquinas.filter(m => maquinasSeleccionadas.has(m.maquina_id))
      : maquinas.slice(0, 8)

    const buckets = Array.from(new Set(tendencia.map(p => p.bucket))).sort()
    const seleccIds = new Set(seleccionadas.map(m => m.maquina_id))
    const rows = buckets.map(bk => {
      const row: Record<string, number | string> = { bucket: bk }
      tendencia
        .filter(p => p.bucket === bk && seleccIds.has(p.maquina_id))
        .forEach(p => { row[`m${p.maquina_id}`] = p.ocupacion_pct })
      return row
    })
    return { tendenciaRows: rows, maquinasGrafico: seleccionadas }
  }, [tendencia, maquinas, maquinasSeleccionadas])

  // Navegación de cursor por mes/semana
  const handlePrev = () => {
    if (period === 'mes') setCursor(c => subMonths(c, 1))
    else if (period === 'semana') setCursor(c => subWeeks(c, 1))
  }
  const handleNext = () => {
    if (period === 'mes') setCursor(c => addMonths(c, 1))
    else if (period === 'semana') setCursor(c => addWeeks(c, 1))
  }
  const handleHoy = () => setCursor(new Date())

  const toggleMaquinaGrafico = (id: number) => {
    setMaquinasSeleccionadas(prev => {
      const base = prev ?? new Set(maquinas.slice(0, 8).map(m => m.maquina_id))
      const next = new Set(base)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const mostrarSelectorMaquinas = maquinas.length > 8

  return (
    <div className="space-y-6">
      {/* ─── Selector de período ─── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
          {([
            { id: 'ytd',     label: 'YTD'      },
            { id: 'mes',     label: 'Mensual'  },
            { id: 'semana',  label: 'Semanal'  },
            { id: 'rango',   label: 'Rango'    },
          ] as { id: PeriodMode; label: string }[]).map(opt => (
            <button
              key={opt.id}
              onClick={() => setPeriod(opt.id)}
              className={`px-3 py-1.5 text-sm font-medium transition-all ${
                period === opt.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {(period === 'mes' || period === 'semana') && (
          <div className="flex items-center gap-2">
            <button onClick={handlePrev} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
              <ChevronLeft size={16} className="text-slate-600" />
            </button>
            <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 min-w-[200px] text-center capitalize">
              {labelPeriodo}
            </div>
            <button onClick={handleNext} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
              <ChevronRight size={16} className="text-slate-600" />
            </button>
            <button
              onClick={handleHoy}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 border border-blue-100"
            >
              Hoy
            </button>
          </div>
        )}

        {period === 'ytd' && (
          <span className="text-sm text-slate-500 flex items-center gap-2">
            <Calendar size={14} />
            {labelPeriodo}
          </span>
        )}

        {period === 'rango' && (
          <div className="flex items-center gap-2 text-sm">
            <label className="text-slate-500">Desde</label>
            <input
              type="date"
              value={rangoDesde}
              onChange={e => setRangoDesde(e.target.value)}
              className="px-2 py-1 rounded border border-slate-200 text-slate-700"
            />
            <label className="text-slate-500">Hasta</label>
            <input
              type="date"
              value={rangoHasta}
              onChange={e => setRangoHasta(e.target.value)}
              className="px-2 py-1 rounded border border-slate-200 text-slate-700"
            />
          </div>
        )}

        {data && (
          <div className="ml-auto text-xs text-slate-500">
            {data.horas_disponibles_periodo.toFixed(1)} h hábiles en el período
          </div>
        )}
      </div>

      {/* ─── KPIs ─── */}
      {isLoading ? (
        <Loading label="Calculando ocupaciones..." />
      ) : maquinas.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <Factory size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-slate-400 font-medium">Sin máquinas con capacidad declarada.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<Gauge size={22} className="text-blue-600" />}
              label="Ocupación promedio"
              value={stats ? `${stats.promedio.toFixed(1)}%` : '—'}
              sub={`${maquinas.length} máquinas`}
              accent="bg-blue-100"
            />
            <KpiCard
              icon={<TrendingUp size={22} className="text-emerald-600" />}
              label="Más ocupada"
              value={stats?.maxOcup ? `${stats.maxOcup.ocupacion_pct.toFixed(1)}%` : '—'}
              sub={stats?.maxOcup?.maquina_nombre}
              accent="bg-emerald-100"
            />
            <KpiCard
              icon={<TrendingDown size={22} className="text-amber-600" />}
              label="Más libre"
              value={stats?.minOcup ? `${stats.minOcup.ocupacion_pct.toFixed(1)}%` : '—'}
              sub={stats?.minOcup?.maquina_nombre}
              accent="bg-amber-100"
            />
            <KpiCard
              icon={<Factory size={22} className="text-violet-600" />}
              label="Producidas / Teóricas"
              value={stats ? `${fmtUnidades(stats.totalProducidas)} / ${fmtUnidades(stats.totalTeoricas)}` : '—'}
              sub="produccion + clase B"
              accent="bg-violet-100"
            />
          </div>

          {/* ─── Tabla detallada ─── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                Ocupación por máquina · {labelPeriodo}
              </h3>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" />≥90%</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />70-90%</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />40-70%</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-400" />&lt;40%</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Máquina</th>
                    <th className="px-4 py-2 text-left font-semibold">Centro</th>
                    <th className="px-4 py-2 text-right font-semibold">Cap/h</th>
                    <th className="px-4 py-2 text-right font-semibold">Horas disp</th>
                    <th className="px-4 py-2 text-right font-semibold">Unid. teóricas</th>
                    <th className="px-4 py-2 text-right font-semibold">Unid. producidas</th>
                    <th className="px-4 py-2 text-left font-semibold w-1/4">% Ocupación</th>
                  </tr>
                </thead>
                <tbody>
                  {maquinas.map((m, idx) => {
                    const color = ocupacionColor(m.ocupacion_pct)
                    const widthPct = Math.min(m.ocupacion_pct, 100)
                    const teorZero = m.unidades_teoricas === 0
                    return (
                      <tr key={m.maquina_id} className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-blue-50/30 transition-colors`}>
                        <td className="px-4 py-2 font-medium text-slate-700">{m.maquina_nombre}</td>
                        <td className="px-4 py-2 text-slate-500 text-xs">{m.centro_costos ?? '—'}</td>
                        <td className="px-4 py-2 text-right text-slate-600 tabular-nums">{m.capacidad_hora.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-slate-600 tabular-nums">{m.horas_disponibles.toFixed(1)}</td>
                        <td className="px-4 py-2 text-right text-slate-600 tabular-nums">{m.unidades_teoricas.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-slate-700 font-medium tabular-nums">{m.unidades_producidas.toLocaleString()}</td>
                        <td className="px-4 py-2">
                          {teorZero ? (
                            <span className="text-slate-400 text-xs">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${color.bar} transition-all`}
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                              <span className={`text-xs font-semibold w-12 text-right ${color.text}`}>
                                {m.ocupacion_pct.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Gráfico de tendencia mensual ─── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                  Tendencia mensual de ocupación
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Últimos 12 meses · % ocupación por máquina</p>
              </div>
              {mostrarSelectorMaquinas && (
                <div className="flex flex-wrap gap-1.5 max-w-[60%]">
                  {maquinas.map(m => {
                    const activa = maquinasGrafico.some(mm => mm.maquina_id === m.maquina_id)
                    return (
                      <button
                        key={m.maquina_id}
                        onClick={() => toggleMaquinaGrafico(m.maquina_id)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                          activa
                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {m.maquina_nombre}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {tendenciaRows.length === 0 ? (
              <p className="text-slate-400 text-sm py-8 text-center">Sin datos para mostrar.</p>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={tendenciaRows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis domain={[0, 120]} tick={{ fontSize: 11 }} stroke="#94a3b8" unit="%" />
                    <Tooltip
                      formatter={(v) => `${Number(v).toFixed(1)}%`}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {maquinasGrafico.map((m, i) => (
                      <Line
                        key={m.maquina_id}
                        type="monotone"
                        dataKey={`m${m.maquina_id}`}
                        name={m.maquina_nombre}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
