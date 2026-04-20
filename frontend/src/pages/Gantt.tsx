import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfWeek, addDays, addWeeks, subWeeks, differenceInMinutes, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, CalendarRange, Factory, GanttChartSquare } from 'lucide-react'
import { getGanttData } from '../api/gantt'
import Loading from '../components/Loading'

type GanttTarea = {
  id: string; texto: string; inicio: string; fin: string
  progreso: number; tipo: string; estado: string
  maquina_id: number; maquina_nombre: string
  item?: string; marca?: string; cantidad?: number
  cant_consumida?: number; horas_estimadas?: number; color?: string
}

type GanttRecurso = { id: number; nombre: string; capacidad_hora: number; centro?: string; sobrecargada: boolean }

const ESTADO_COLOR: Record<string, string> = {
  'En proceso':         '#f59e0b',
  'Pendiente':          '#3b82f6',
  'Completado':         '#10b981',
  'Suspendida':         '#ef4444',
  'En Mantenimiento':   '#64748b',
  'Parada Programada':  '#64748b',
}

const DAY_INITIALS: Record<number, string> = {
  1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D',
}

const DIAS = 7
const ROW_HEIGHT = 56
const HEADER_HEIGHT = 72
const LABEL_COL_WIDTH = 220

export default function GanttPage() {
  const [semana, setSemana] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const desde = format(semana, "yyyy-MM-dd'T'00:00:00")
  const hasta = format(addDays(semana, DIAS - 1), "yyyy-MM-dd'T'23:59:59")

  const { data, isLoading } = useQuery({
    queryKey: ['gantt', desde, hasta],
    queryFn: () => getGanttData({ desde, hasta }),
  })

  const recursos: GanttRecurso[] = data?.recursos ?? []
  const tareas: GanttTarea[] = data?.tareas ?? []

  const semanaInicio = semana
  const semanaFin = addDays(semana, DIAS - 1)

  // Calcular posición de una barra en el grid
  const posicion = (inicio: string, fin: string) => {
    const inicioDate = new Date(inicio)
    const finDate = new Date(fin)
    const semanaStart = startOfDay(semanaInicio)
    const totalMins = DIAS * 24 * 60

    const startMins = Math.max(differenceInMinutes(inicioDate, semanaStart), 0)
    const endMins = Math.min(differenceInMinutes(finDate, semanaStart), totalMins)
    const left = (startMins / totalMins) * 100
    const width = Math.max(((endMins - startMins) / totalMins) * 100, 0.5)
    return { left: `${left}%`, width: `${width}%` }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top gradient hero ── */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          {/* Title row */}
          <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <CalendarRange size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Cronograma</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Diagrama de Gantt</h1>
            </div>
            <button
              onClick={() => setSemana(startOfWeek(new Date(), { weekStartsOn: 1 }))}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-xl border border-white/20 transition-all backdrop-blur-sm"
            >
              Hoy
            </button>
          </div>

          {/* Week navigator */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setSemana(w => subWeeks(w, 1))}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="text-center px-6 py-3 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 min-w-[260px]">
              <p className="text-white font-semibold text-lg capitalize">
                {format(semanaInicio, "'Semana del' dd 'de' MMMM", { locale: es })}
              </p>
              <p className="text-blue-200 text-xs mt-0.5">
                {format(semanaInicio, 'yyyy', { locale: es })} · {format(semanaInicio, 'dd/MM', { locale: es })} – {format(semanaFin, 'dd/MM', { locale: es })}
              </p>
            </div>
            <button
              onClick={() => setSemana(w => addWeeks(w, 1))}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">

        {isLoading && <Loading label="Cargando Gantt..." />}

        {!isLoading && recursos.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
            <GanttChartSquare size={40} className="mx-auto text-slate-200 mb-3" />
            <p className="text-slate-400 font-medium">Sin máquinas configuradas.</p>
            <p className="text-slate-300 text-sm mt-1">Configura recursos para visualizar el cronograma.</p>
          </div>
        )}

        {!isLoading && recursos.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {/* Leyenda */}
            <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-b border-slate-100 bg-slate-50">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Estados:</span>
              {Object.entries(ESTADO_COLOR).map(([estado, color]) => (
                <span key={estado} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
                  {estado}
                </span>
              ))}
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-max">
                {/* Header de días */}
                <div className="flex border-b border-slate-100 bg-white">
                  <div
                    className="shrink-0 px-5 py-3 border-r border-slate-100 sticky left-0 bg-white z-10 flex items-center"
                    style={{ width: LABEL_COL_WIDTH, height: HEADER_HEIGHT }}
                  >
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Centro de Trabajo</span>
                  </div>
                  <div className="flex flex-1">
                    {Array.from({ length: DIAS }).map((_, i) => {
                      const dia = addDays(semanaInicio, i)
                      const esHoy = format(dia, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                      const dayInitial = DAY_INITIALS[dia.getDay()] ?? format(dia, 'EEEEE', { locale: es }).toUpperCase()
                      return (
                        <div
                          key={i}
                          className={`flex-1 flex flex-col items-center justify-center gap-1 border-r border-slate-100 last:border-r-0 ${esHoy ? 'bg-blue-50/60' : ''}`}
                          style={{ height: HEADER_HEIGHT, minWidth: 120 }}
                        >
                          <div className={`w-8 h-8 rounded-full font-bold text-sm flex items-center justify-center ${esHoy ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700'}`}>
                            {dayInitial}
                          </div>
                          <span className={`text-[10px] font-medium ${esHoy ? 'text-blue-700' : 'text-slate-400'}`}>
                            {format(dia, 'dd/MM', { locale: es })}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Filas por máquina */}
                {recursos.map((rec, idx) => {
                  const tareasRec = tareas.filter(t => t.maquina_id === rec.id)
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                  return (
                    <div
                      key={rec.id}
                      className={`flex border-b border-slate-100 last:border-b-0 ${rowBg} transition-colors hover:bg-blue-50/40`}
                    >
                      {/* Nombre máquina */}
                      <div
                        className={`shrink-0 px-5 py-2 border-r border-slate-100 sticky left-0 z-10 ${rowBg} flex items-center gap-2`}
                        style={{ width: LABEL_COL_WIDTH }}
                      >
                        <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Factory size={13} className="text-blue-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-700 text-sm leading-tight truncate">{rec.nombre}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-slate-400">{rec.capacidad_hora.toLocaleString()} u/h</span>
                            {rec.sobrecargada && (
                              <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md">
                                Sobrecargada
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Grid de barras */}
                      <div className="flex-1 relative" style={{ height: ROW_HEIGHT }}>
                        {/* Líneas divisoras de días */}
                        {Array.from({ length: DIAS }).map((_, i) => {
                          const dia = addDays(semanaInicio, i)
                          const esHoy = format(dia, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                          return (
                            <div
                              key={i}
                              className={`absolute top-0 bottom-0 ${esHoy ? 'bg-blue-50/40' : ''}`}
                              style={{
                                left: `${(i / DIAS) * 100}%`,
                                width: `${(1 / DIAS) * 100}%`,
                                borderRight: '1px dashed #e2e8f0',
                              }}
                            />
                          )
                        })}

                        {/* Barras */}
                        {tareasRec.map((t) => {
                          const { left, width } = posicion(t.inicio, t.fin)
                          const color = t.color || ESTADO_COLOR[t.estado] || '#3b82f6'
                          return (
                            <div
                              key={t.id}
                              className="absolute top-2 rounded-lg cursor-pointer transition-all hover:shadow-md hover:-translate-y-[1px] overflow-hidden"
                              style={{
                                left,
                                width,
                                height: ROW_HEIGHT - 16,
                                background: `linear-gradient(to bottom, ${color}EE, ${color}CC)`,
                                boxShadow: `0 1px 2px ${color}40`,
                              }}
                              title={`${t.texto}\n${t.item || ''}\nEstado: ${t.estado}\nHoras est.: ${t.horas_estimadas ?? 'N/A'}h`}
                            >
                              {/* Barra de progreso */}
                              {t.progreso > 0 && (
                                <div
                                  className="absolute top-0 left-0 bottom-0"
                                  style={{
                                    width: `${t.progreso * 100}%`,
                                    background: `linear-gradient(to bottom, ${color}, ${color}DD)`,
                                  }}
                                />
                              )}
                              <p className="relative z-10 text-white text-xs font-semibold truncate px-2 leading-[40px] drop-shadow-sm">
                                {t.texto}
                              </p>
                            </div>
                          )
                        })}
                      </div>
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
