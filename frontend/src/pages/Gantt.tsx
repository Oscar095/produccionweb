import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  format, addDays,
  differenceInMinutes, differenceInDays, startOfDay,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightSm, CalendarRange, Layers, GanttChartSquare } from 'lucide-react'
import { getGanttData } from '../api/gantt'
import Loading from '../components/Loading'

type GanttOpDetalle = {
  docto: number
  item?: string | null
  marca?: string | null
  cantidad: number
  cant_consumida: number
  unidades_pendientes: number
  fecha_entrega?: string | null
  dias_estimados: number
  fecha_fin_proyectada?: string | null
  clase: 'atrasada' | 'en_riesgo' | 'a_tiempo'
  color: string
}

type GanttTarea = {
  id: string
  texto: string
  inicio: string
  fin: string
  tipo: string
  estado: string
  ruta_id: number
  ruta_nombre: string
  num_ops: number
  unidades_total: number
  unidades_pendientes: number
  horas_estimadas: number
  dias_estimados: number
  capacidad_diaria: number
  dias_atrasado: number
  dias_riesgo: number
  dias_a_tiempo: number
  num_ops_atrasado: number
  num_ops_riesgo: number
  num_ops_a_tiempo: number
  fecha_entrega_min?: string | null
}

type GanttRecurso = {
  id: number
  nombre: string
  orden?: number | null
  num_maquinas: number
  capacidad_hora_total: number
  capacidad_diaria: number
  num_ops: number
  unidades_pendientes: number
  dias_estimados: number
  sobrecargada: boolean
  ops: GanttOpDetalle[]
}

type ViewMode = 'monthly' | 'weekly'

const COLOR_ATRASADO = '#EF4444'
const COLOR_RIESGO   = '#F59E0B'
const COLOR_A_TIEMPO = '#3B82F6'
const COLOR_VACIO    = '#9CA3AF'

const ESTADO_LABEL: Record<string, { label: string, color: string }> = {
  'Atrasado':  { label: 'Atrasado',  color: COLOR_ATRASADO },
  'En riesgo': { label: 'En riesgo', color: COLOR_RIESGO   },
  'A tiempo':  { label: 'A tiempo',  color: COLOR_A_TIEMPO },
  'Sin carga': { label: 'Sin carga', color: COLOR_VACIO    },
}

const CLASE_LABEL: Record<GanttOpDetalle['clase'], string> = {
  atrasada:   'Atrasada',
  en_riesgo:  'En riesgo',
  a_tiempo:   'A tiempo',
}

const DAY_INITIALS: Record<number, string> = {
  1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D',
}

const ROW_HEIGHT = 56
const HEADER_HEIGHT = 78
const LABEL_COL_WIDTH = 280
const MIN_DAY_WIDTH_WEEKLY = 120
const MIN_DAY_WIDTH_MONTHLY = 56

// Ventana rolling: el rango siempre arranca en `cursor` (= hoy por defecto).
const DIAS_MENSUAL = 31
const DIAS_SEMANAL = 7

const fmtUnidades = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

const fmtFecha = (s?: string | null) => s ? format(new Date(s), 'dd MMM yyyy', { locale: es }) : '—'

export default function GanttPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('monthly')
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()))
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const { rangeStart, rangeEnd, dias, minDayWidth } = useMemo(() => {
    const start = startOfDay(cursor)
    const totalDias = viewMode === 'monthly' ? DIAS_MENSUAL : DIAS_SEMANAL
    return {
      rangeStart: start,
      rangeEnd: addDays(start, totalDias - 1),
      dias: totalDias,
      minDayWidth: viewMode === 'monthly' ? MIN_DAY_WIDTH_MONTHLY : MIN_DAY_WIDTH_WEEKLY,
    }
  }, [cursor, viewMode])

  const desde = format(rangeStart, "yyyy-MM-dd'T'00:00:00")
  const hasta = format(rangeEnd, "yyyy-MM-dd'T'23:59:59")

  const { data, isLoading } = useQuery({
    queryKey: ['gantt', viewMode, desde, hasta],
    queryFn: () => getGanttData({ desde, hasta }),
    enabled: tab === 'carga',
  })

  const recursos: GanttRecurso[] = data?.recursos ?? []
  const tareas: GanttTarea[] = data?.tareas ?? []

  // Posición de la barra agregada dentro del rango actual.
  const posicionBarra = (inicio: string, fin: string) => {
    const inicioDate = new Date(inicio)
    const finDate = new Date(fin)
    const startRef = startOfDay(rangeStart)
    const totalMins = dias * 24 * 60

    const startMins = Math.max(differenceInMinutes(inicioDate, startRef), 0)
    const endMins = Math.min(differenceInMinutes(finDate, startRef), totalMins)
    if (endMins <= 0 || startMins >= totalMins) return null
    const left = (startMins / totalMins) * 100
    const width = Math.max(((endMins - startMins) / totalMins) * 100, 0.5)
    return { left: `${left}%`, width: `${width}%` }
  }

  // Posición vertical de "hoy" dentro del grid (% sobre el ancho del rango).
  const todayLeftPct = useMemo(() => {
    const now = new Date()
    const startRef = startOfDay(rangeStart)
    const totalMins = dias * 24 * 60
    const mins = differenceInMinutes(now, startRef)
    if (mins < 0 || mins > totalMins) return null
    return (mins / totalMins) * 100
  }, [rangeStart, dias])

  const today = useMemo(() => startOfDay(new Date()), [])
  const blockSize = viewMode === 'monthly' ? DIAS_MENSUAL : DIAS_SEMANAL
  const isAtToday = differenceInDays(cursor, today) <= 0

  const handlePrev = () => {
    if (isAtToday) return
    setCursor(c => {
      const candidate = addDays(c, -blockSize)
      return candidate < today ? today : candidate
    })
  }
  const handleNext = () => setCursor(c => addDays(c, blockSize))
  const handleToday = () => setCursor(today)

  const headerLabel = viewMode === 'monthly'
    ? `Próximos ${DIAS_MENSUAL} días`
    : `Próximos ${DIAS_SEMANAL} días`

  const headerSubLabel = `${format(rangeStart, 'dd MMM yyyy', { locale: es })} – ${format(rangeEnd, 'dd MMM yyyy', { locale: es })}`

  const gridWidth = LABEL_COL_WIDTH + dias * minDayWidth

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <CalendarRange size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Carga proyectada</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Gantt por Centro de Trabajo</h1>
              <p className="text-blue-200 text-sm mt-1">
                Cada barra muestra los días hábiles necesarios, segmentados en atrasado, en riesgo y a tiempo.
              </p>
            </div>
            <div className="flex items-center gap-2">
                <div className="inline-flex rounded-xl border border-white/20 overflow-hidden bg-white/5 backdrop-blur-sm">
                  <button
                    onClick={() => setViewMode('monthly')}
                    className={`px-3 py-2 text-sm font-medium transition-all ${viewMode === 'monthly' ? 'bg-white text-slate-800' : 'text-white hover:bg-white/10'}`}
                  >
                    Mensual
                  </button>
                  <button
                    onClick={() => setViewMode('weekly')}
                    className={`px-3 py-2 text-sm font-medium transition-all ${viewMode === 'weekly' ? 'bg-white text-slate-800' : 'text-white hover:bg-white/10'}`}
                  >
                    Semanal
                  </button>
                </div>
                <button
                  onClick={handleToday}
                  className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-xl border border-white/20 transition-all backdrop-blur-sm"
                >
                  Hoy
                </button>
              </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handlePrev}
              disabled={isAtToday}
              title={isAtToday ? 'Ya estás en el bloque actual' : 'Bloque anterior'}
              className={`p-2 rounded-xl border transition-all ${
                isAtToday
                  ? 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
              }`}
            >
              <ChevronLeft size={18} />
            </button>
            <div className="text-center px-6 py-3 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 min-w-[260px]">
              <p className="text-white font-semibold text-lg">{headerLabel}</p>
              <p className="text-blue-200 text-xs mt-0.5">{headerSubLabel}</p>
            </div>
            <button
              onClick={handleNext}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">

        {isLoading && <Loading label="Calculando carga..." />}

        {!isLoading && recursos.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
            <GanttChartSquare size={40} className="mx-auto text-slate-200 mb-3" />
            <p className="text-slate-400 font-medium">Sin Rutas SIESA configuradas.</p>
            <p className="text-slate-300 text-sm mt-1">Crea rutas y asígnales máquinas en Configuración.</p>
          </div>
        )}

        {!isLoading && recursos.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {/* Leyenda */}
            <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-b border-slate-100 bg-slate-50">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Leyenda:</span>
              {Object.entries(ESTADO_LABEL).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: v.color }} />
                  {v.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-xs text-slate-500 ml-auto">
                <span className="w-2.5 h-2.5 rounded-sm inline-block bg-slate-300" />
                Sáb / Dom (sin producción)
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="w-[2px] h-3 inline-block bg-blue-600" />
                Hoy
              </span>
            </div>

            <div className="overflow-x-auto">
              <div style={{ minWidth: gridWidth }}>
                {/* Header de días */}
                <div className="flex border-b border-slate-200 bg-white">
                  <div
                    className="shrink-0 px-5 py-3 border-r border-slate-200 sticky left-0 bg-white z-10 flex items-center"
                    style={{ width: LABEL_COL_WIDTH, height: HEADER_HEIGHT }}
                  >
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Centro de Trabajo</span>
                  </div>
                  <div className="flex flex-1 relative">
                    {Array.from({ length: dias }).map((_, i) => {
                      const dia = addDays(rangeStart, i)
                      const dow = dia.getDay()
                      const isWeekend = dow === 0 || dow === 6
                      const esHoy = format(dia, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                      const dayInitial = DAY_INITIALS[dow] ?? format(dia, 'EEEEE', { locale: es }).toUpperCase()
                      const bg = esHoy ? 'bg-blue-100' : isWeekend ? 'bg-slate-200/70' : ''
                      return (
                        <div
                          key={i}
                          className={`flex-1 flex flex-col items-center justify-center gap-1 border-r border-slate-100 last:border-r-0 ${bg} ${esHoy ? 'border-b-2 border-b-blue-600' : ''}`}
                          style={{ height: HEADER_HEIGHT, minWidth: minDayWidth }}
                        >
                          <div
                            className={`w-7 h-7 rounded-full font-bold text-xs flex items-center justify-center ${
                              esHoy ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                                : isWeekend ? 'bg-slate-300 text-slate-600'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {dayInitial}
                          </div>
                          <span className={`text-[10px] font-medium ${esHoy ? 'text-blue-800 font-bold' : isWeekend ? 'text-slate-500' : 'text-slate-400'}`}>
                            {format(dia, viewMode === 'monthly' ? 'dd' : 'dd/MM', { locale: es })}
                          </span>
                          {esHoy && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-blue-700">Hoy</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Filas por Centro de Trabajo */}
                {recursos.map((rec, idx) => {
                  const tarea = tareas.find(t => t.ruta_id === rec.id)
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                  const expanded = expandedIds.has(rec.id)
                  const estadoInfo = tarea ? ESTADO_LABEL[tarea.estado] : null

                  return (
                    <div key={rec.id} className="border-b border-slate-100 last:border-b-0">
                      {/* Fila principal */}
                      <div className={`flex ${rowBg} transition-colors hover:bg-blue-50/40`}>
                        {/* Etiqueta + dropdown */}
                        <div
                          className={`shrink-0 px-3 py-2 border-r border-slate-200 sticky left-0 z-10 ${rowBg} flex items-center gap-2`}
                          style={{ width: LABEL_COL_WIDTH }}
                        >
                          <button
                            onClick={() => toggleExpand(rec.id)}
                            disabled={rec.num_ops === 0}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            title={rec.num_ops === 0 ? 'Sin OPs' : (expanded ? 'Ocultar OPs' : 'Ver OPs')}
                          >
                            {expanded ? <ChevronDown size={16} /> : <ChevronRightSm size={16} />}
                          </button>
                          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <Layers size={16} className="text-blue-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-700 text-sm leading-tight truncate" title={rec.nombre}>
                              {rec.nombre}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                              <span className="text-[10px] text-slate-400">
                                {rec.num_maquinas} máq · {fmtUnidades(rec.capacidad_diaria)} u/día
                              </span>
                              {rec.num_ops > 0 ? (
                                <span className="text-[10px] font-semibold text-slate-600">
                                  {rec.num_ops} OPs · {rec.dias_estimados.toFixed(1)} días
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">sin OPs</span>
                              )}
                              {estadoInfo && rec.num_ops > 0 && (
                                <span
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                                  style={{ backgroundColor: `${estadoInfo.color}20`, color: estadoInfo.color }}
                                >
                                  {estadoInfo.label}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Grid + barra segmentada */}
                        <div className="flex-1 relative" style={{ height: ROW_HEIGHT }}>
                          {/* Fondos de columnas (hoy + sáb/dom) */}
                          {Array.from({ length: dias }).map((_, i) => {
                            const dia = addDays(rangeStart, i)
                            const dow = dia.getDay()
                            const isWeekend = dow === 0 || dow === 6
                            const esHoy = format(dia, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                            const bg = esHoy ? 'bg-blue-100/50' : isWeekend ? 'bg-slate-200/60' : ''
                            return (
                              <div
                                key={i}
                                className={`absolute top-0 bottom-0 ${bg}`}
                                style={{
                                  left: `${(i / dias) * 100}%`,
                                  width: `${(1 / dias) * 100}%`,
                                  borderRight: '1px dashed #e2e8f0',
                                }}
                              />
                            )
                          })}

                          {/* Línea vertical de "hoy" */}
                          {todayLeftPct !== null && todayLeftPct > 0.5 && (
                            <div
                              className="absolute top-0 bottom-0 w-[2px] bg-blue-600 z-[6] pointer-events-none"
                              style={{ left: `${todayLeftPct}%` }}
                            />
                          )}

                          {/* Barra segmentada */}
                          {tarea && (() => {
                            const pos = posicionBarra(tarea.inicio, tarea.fin)
                            if (!pos) return null
                            const totalDias = tarea.dias_estimados || 1
                            const segmentos = [
                              { dias: tarea.dias_atrasado, color: COLOR_ATRASADO, label: 'Atrasado',  ops: tarea.num_ops_atrasado },
                              { dias: tarea.dias_riesgo,   color: COLOR_RIESGO,   label: 'En riesgo', ops: tarea.num_ops_riesgo   },
                              { dias: tarea.dias_a_tiempo, color: COLOR_A_TIEMPO, label: 'A tiempo',  ops: tarea.num_ops_a_tiempo },
                            ].filter(s => s.dias > 0)

                            if (segmentos.length === 0) {
                              // Sin carga: barra gris fina con texto
                              return (
                                <div
                                  className="absolute top-2 rounded-lg overflow-hidden flex items-center px-2"
                                  style={{
                                    left: pos.left,
                                    width: pos.width,
                                    height: ROW_HEIGHT - 16,
                                    background: COLOR_VACIO,
                                    opacity: 0.5,
                                  }}
                                >
                                  <span className="text-white text-[11px] font-medium truncate">{tarea.texto}</span>
                                </div>
                              )
                            }

                            return (
                              <div
                                className="absolute top-2 rounded-lg overflow-hidden flex shadow-sm"
                                style={{
                                  left: pos.left,
                                  width: pos.width,
                                  height: ROW_HEIGHT - 16,
                                }}
                                title={[
                                  `Centro: ${tarea.ruta_nombre}`,
                                  `OPs activas: ${tarea.num_ops}`,
                                  `Pendiente: ${tarea.unidades_pendientes.toLocaleString()} u`,
                                  `Capacidad: ${tarea.capacidad_diaria.toLocaleString()} u/día`,
                                  `Total: ${tarea.dias_estimados.toFixed(1)} días`,
                                  tarea.dias_atrasado > 0 ? `  • Atrasado: ${tarea.dias_atrasado.toFixed(1)} días (${tarea.num_ops_atrasado} OPs)` : '',
                                  tarea.dias_riesgo   > 0 ? `  • En riesgo: ${tarea.dias_riesgo.toFixed(1)} días (${tarea.num_ops_riesgo} OPs)` : '',
                                  tarea.dias_a_tiempo > 0 ? `  • A tiempo: ${tarea.dias_a_tiempo.toFixed(1)} días (${tarea.num_ops_a_tiempo} OPs)` : '',
                                ].filter(Boolean).join('\n')}
                              >
                                {segmentos.map((s, i) => (
                                  <div
                                    key={s.label}
                                    className="h-full flex items-center justify-center overflow-hidden relative"
                                    style={{
                                      flex: s.dias / totalDias,
                                      background: `linear-gradient(to bottom, ${s.color}EE, ${s.color}CC)`,
                                      borderRight: i < segmentos.length - 1 ? '1px solid rgba(255,255,255,0.5)' : 'none',
                                    }}
                                  >
                                    <span className="text-white text-[10px] font-bold px-1 truncate drop-shadow">
                                      {s.dias.toFixed(1)}d
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      </div>

                      {/* Listado de OPs (dropdown) */}
                      {expanded && rec.ops.length > 0 && (
                        <div className="bg-slate-50/80 border-t border-slate-200">
                          <div className="px-4 py-3" style={{ paddingLeft: 24 }}>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-slate-500 uppercase tracking-wide">
                                    <th className="px-2 py-1.5 font-semibold">Estado</th>
                                    <th className="px-2 py-1.5 font-semibold">OP</th>
                                    <th className="px-2 py-1.5 font-semibold">Item</th>
                                    <th className="px-2 py-1.5 font-semibold text-right">Pendiente</th>
                                    <th className="px-2 py-1.5 font-semibold text-right">Días</th>
                                    <th className="px-2 py-1.5 font-semibold">Entrega</th>
                                    <th className="px-2 py-1.5 font-semibold">Fin proyectado</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rec.ops.map(op => (
                                    <tr
                                      key={op.docto}
                                      className="border-t border-slate-200/70 hover:bg-white"
                                      style={{ borderLeft: `3px solid ${op.color}` }}
                                    >
                                      <td className="px-2 py-1.5">
                                        <span
                                          className="inline-flex items-center gap-1.5 font-semibold text-[11px] px-1.5 py-0.5 rounded"
                                          style={{ backgroundColor: `${op.color}22`, color: op.color }}
                                        >
                                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: op.color }} />
                                          {CLASE_LABEL[op.clase]}
                                        </span>
                                      </td>
                                      <td className="px-2 py-1.5 font-mono font-semibold text-slate-700">
                                        {op.docto}
                                      </td>
                                      <td className="px-2 py-1.5 text-slate-600 truncate max-w-[260px]" title={op.item ?? ''}>
                                        {op.item ?? '—'}
                                        {op.marca && <span className="text-slate-400 ml-1">· {op.marca}</span>}
                                      </td>
                                      <td className="px-2 py-1.5 text-right text-slate-700 tabular-nums">
                                        {op.unidades_pendientes.toLocaleString()}
                                      </td>
                                      <td className="px-2 py-1.5 text-right text-slate-700 tabular-nums">
                                        {op.dias_estimados.toFixed(2)}
                                      </td>
                                      <td className="px-2 py-1.5 text-slate-600">{fmtFecha(op.fecha_entrega)}</td>
                                      <td className="px-2 py-1.5 text-slate-600">{fmtFecha(op.fecha_fin_proyectada)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
