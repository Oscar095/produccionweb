import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfWeek, addDays, addWeeks, subWeeks, differenceInMinutes, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getGanttData } from '../api/gantt'

type GanttTarea = {
  id: string; texto: string; inicio: string; fin: string
  progreso: number; tipo: string; estado: string
  maquina_id: number; maquina_nombre: string
  item?: string; marca?: string; cantidad?: number
  cant_consumida?: number; horas_estimadas?: number; color?: string
}

type GanttRecurso = { id: number; nombre: string; capacidad_hora: number; centro?: string; sobrecargada: boolean }

const ESTADO_COLOR: Record<string, string> = {
  'En proceso':         '#3B82F6',
  'Pendiente':          '#9CA3AF',
  'Completado':         '#22C55E',
  'Suspendida':         '#F59E0B',
  'En Mantenimiento':   '#EF4444',
  'Parada Programada':  '#8B5CF6',
}

const DIAS = 7
const ROW_HEIGHT = 52
const HEADER_HEIGHT = 48

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
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Diagrama de Gantt</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => setSemana(w => subWeeks(w, 1))}
            className="p-2 rounded-lg border hover:bg-gray-100">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[180px] text-center">
            {format(semanaInicio, "dd MMM", { locale: es })} — {format(semanaFin, "dd MMM yyyy", { locale: es })}
          </span>
          <button onClick={() => setSemana(w => addWeeks(w, 1))}
            className="p-2 rounded-lg border hover:bg-gray-100">
            <ChevronRight size={18} />
          </button>
          <button onClick={() => setSemana(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-100">
            Hoy
          </button>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(ESTADO_COLOR).map(([estado, color]) => (
          <span key={estado} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: color }} />
            {estado}
          </span>
        ))}
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Cargando datos...</p>}

      {!isLoading && recursos.length === 0 && (
        <p className="text-gray-500 text-sm">Sin máquinas configuradas.</p>
      )}

      {recursos.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-auto border">
          {/* Header de días */}
          <div className="flex" style={{ marginLeft: 160 }}>
            {Array.from({ length: DIAS }).map((_, i) => {
              const dia = addDays(semanaInicio, i)
              const esHoy = format(dia, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
              return (
                <div key={i} className={`flex-1 text-center text-xs font-medium py-3 border-b border-r
                  ${esHoy ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}
                  style={{ height: HEADER_HEIGHT }}>
                  {format(dia, 'EEE dd', { locale: es })}
                </div>
              )
            })}
          </div>

          {/* Filas por máquina */}
          {recursos.map((rec) => {
            const tareasRec = tareas.filter(t => t.maquina_id === rec.id)
            return (
              <div key={rec.id} className="flex border-b last:border-b-0 group hover:bg-gray-50 transition">
                {/* Nombre máquina */}
                <div className="shrink-0 w-40 px-3 py-2 border-r bg-white z-10">
                  <p className="text-sm font-medium text-gray-800 truncate">{rec.nombre}</p>
                  <p className="text-xs text-gray-400">{rec.capacidad_hora.toLocaleString()} u/h</p>
                  {rec.sobrecargada && (
                    <span className="text-xs text-red-600 font-medium">Sobrecargada</span>
                  )}
                </div>

                {/* Grid de barras */}
                <div className="flex-1 relative" style={{ height: ROW_HEIGHT }}>
                  {/* Líneas divisoras de días */}
                  {Array.from({ length: DIAS }).map((_, i) => (
                    <div key={i} className="absolute top-0 bottom-0 border-r border-gray-100"
                      style={{ left: `${(i / DIAS) * 100}%` }} />
                  ))}

                  {/* Barras */}
                  {tareasRec.map((t) => {
                    const { left, width } = posicion(t.inicio, t.fin)
                    const color = t.color || ESTADO_COLOR[t.estado] || '#9CA3AF'
                    return (
                      <div
                        key={t.id}
                        className="absolute top-2 rounded cursor-pointer transition-opacity hover:opacity-80 group/bar"
                        style={{ left, width, height: ROW_HEIGHT - 16, backgroundColor: color + 'CC' }}
                        title={`${t.texto}\n${t.item || ''}\nEstado: ${t.estado}\nHoras est.: ${t.horas_estimadas ?? 'N/A'}h`}
                      >
                        {/* Barra de progreso */}
                        {t.progreso > 0 && (
                          <div className="absolute top-0 left-0 bottom-0 rounded"
                            style={{ width: `${t.progreso * 100}%`, backgroundColor: color }} />
                        )}
                        <p className="relative z-10 text-white text-xs font-medium truncate px-2 leading-[36px]">
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
      )}
    </div>
  )
}
