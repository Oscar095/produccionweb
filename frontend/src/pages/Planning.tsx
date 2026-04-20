import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getKanban, bulkKanbanPrioridades, cerrarOP } from '../api/planning'
import { format, startOfWeek, addWeeks, subWeeks, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  GripVertical, LayoutGrid, CalendarDays,
  Layers, Factory, Package, Clock, Inbox,
  ChevronLeft, ChevronRight, CheckCircle2, Loader2,
} from 'lucide-react'
import DeliveryTimeline from '../components/DeliveryTimeline'
import Loading from '../components/Loading'

type OrdenCard = {
  op_docto: number
  item?: string; marca?: string; calibre?: string
  cantidad?: number; cant_consumida?: number
  estado_op?: string; pct_completado?: number
  horas_estimadas?: number
  fecha_entrega?: string
  created_at?: string
  prioridad?: number | null
}

type Columna = {
  maquina_id: number
  maquina_nombre: string
  capacidad_hora: number
  rutas_siesa?: string | null
  ordenes: OrdenCard[]
}

function SortableCard({
  orden,
  onCerrar,
  cerrando,
}: {
  orden: OrdenCard
  onCerrar: (op_docto: number) => void
  cerrando: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: orden.op_docto })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveringPreviewRef = useRef(false)

  const estadoColor: Record<string, string> = {
    'Completado': 'bg-emerald-100 text-emerald-700',
    'En proceso': 'bg-blue-100 text-blue-700',
    'Pendiente':  'bg-slate-100 text-slate-600',
  }

  const fechaEntrega = orden.fecha_entrega
    ? format(parseISO(orden.fecha_entrega), "d MMM yyyy", { locale: es })
    : null

  const clearHide = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
  }

  const handleMouseEnter = () => {
    clearHide()
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setPreviewPos({ top: rect.top, left: rect.right + 8 })
    }
  }

  const handleMouseLeave = () => {
    clearHide()
    hideTimer.current = setTimeout(() => {
      if (!hoveringPreviewRef.current) setPreviewPos(null)
    }, 250)
  }

  const dragClasses = isDragging
    ? 'ring-2 ring-blue-400 shadow-lg rotate-1'
    : 'hover:shadow-md hover:-translate-y-0.5'

  return (
    <div
      ref={el => { setNodeRef(el); (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el }}
      style={style}
      className={`bg-white rounded-xl border border-slate-200 p-3 shadow-sm transition-all cursor-grab ${dragClasses}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {previewPos && createPortal(
        <div
          className="fixed z-[9999] w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs"
          style={{ top: previewPos.top, left: previewPos.left }}
          onMouseEnter={() => { hoveringPreviewRef.current = true; clearHide() }}
          onMouseLeave={() => { hoveringPreviewRef.current = false; setPreviewPos(null) }}
        >
          <p className="font-bold text-slate-700 mb-2 uppercase tracking-wide text-[10px]">Detalle OP</p>
          <div className="space-y-1.5">
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">OP</span><span className="font-medium text-slate-800">{orden.op_docto}</span></div>
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">Item</span><span className="font-medium text-slate-800 break-words">{orden.item || '—'}</span></div>
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">Marca</span><span className="font-medium text-slate-800">{orden.marca || '—'}</span></div>
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">Calibre</span><span className="font-medium text-slate-800">{orden.calibre || '—'}</span></div>
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">Entrega</span><span className={`font-medium ${fechaEntrega ? 'text-slate-800' : 'text-slate-400'}`}>{fechaEntrega || '—'}</span></div>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onCerrar(orden.op_docto)
            }}
            disabled={cerrando}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-70 disabled:cursor-wait text-white rounded-lg py-2 text-[11px] font-semibold transition-colors"
          >
            {cerrando ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Cerrando...
              </>
            ) : (
              <>
                <CheckCircle2 size={13} />
                Dar por cumplido
              </>
            )}
          </button>
        </div>,
        document.body
      )}
      <div className="flex items-start gap-2">
        <button {...attributes} {...listeners} className="mt-1 text-slate-300 hover:text-blue-500 cursor-grab transition-colors">
          <GripVertical size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-blue-700">OP {orden.op_docto}</span>
            {orden.estado_op && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${estadoColor[orden.estado_op] || 'bg-slate-100 text-slate-600'}`}>
                {orden.estado_op}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1 mt-1 min-w-0">
            <span className="text-sm font-medium text-slate-800 truncate">{orden.item}</span>
            {orden.marca && <span className="text-xs text-slate-500 shrink-0">· {orden.marca}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {orden.cantidad !== undefined && (
              <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-md px-2 py-0.5 text-[11px]">
                <Package size={10} />
                {orden.cantidad.toLocaleString()} uds
              </span>
            )}
            {orden.horas_estimadas && (
              <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-md px-2 py-0.5 text-[11px]">
                <Clock size={10} />
                {orden.horas_estimadas.toFixed(1)}h
              </span>
            )}
            {fechaEntrega && (
              <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-md px-2 py-0.5 text-[11px]">
                <CalendarDays size={10} />
                {fechaEntrega}
              </span>
            )}
          </div>
          {(orden.pct_completado ?? 0) > 0 && (
            <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all"
                style={{ width: `${orden.pct_completado}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const COLUMN_ACCENTS = [
  { bar: 'bg-blue-400',    iconBg: 'bg-blue-100',    iconText: 'text-blue-600' },
  { bar: 'bg-emerald-400', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600' },
  { bar: 'bg-amber-400',   iconBg: 'bg-amber-100',   iconText: 'text-amber-600' },
  { bar: 'bg-violet-400',  iconBg: 'bg-violet-100',  iconText: 'text-violet-600' },
  { bar: 'bg-rose-400',    iconBg: 'bg-rose-100',    iconText: 'text-rose-600' },
  { bar: 'bg-cyan-400',    iconBg: 'bg-cyan-100',    iconText: 'text-cyan-600' },
]

export default function Planning() {
  const qc = useQueryClient()
  const [semana, setSemana] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))

  const [tab, setTab] = useState<'kanban' | 'timeline'>('timeline')

  const { data, isLoading } = useQuery({
    queryKey: ['kanban'],
    queryFn: () => getKanban(),
    enabled: tab === 'kanban',
  })

  const cols: Columna[] = data?.columnas ?? []

  const mutPrioridades = useMutation({
    mutationFn: ({ maquina_id, items }: { maquina_id: number; items: Array<{ op_docto: number; prioridad: number }> }) =>
      bulkKanbanPrioridades(maquina_id, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban'] }),
  })

  const [cerrandoOp, setCerrandoOp] = useState<number | null>(null)
  const mutCerrar = useMutation({
    mutationFn: (op_docto: number) => cerrarOP(op_docto),
    onMutate: (op_docto) => { setCerrandoOp(op_docto) },
    onSettled: () => { setCerrandoOp(null) },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kanban'] })
      alert('OP dada por cumplida correctamente.')
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail ?? err?.message ?? 'Error desconocido')
      alert(`No se pudo cerrar la OP:\n${msg}`)
    },
  })

  const handleDragEnd = (event: DragEndEvent, col: Columna) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = col.ordenes.findIndex(o => o.op_docto === active.id)
    const newIdx = col.ordenes.findIndex(o => o.op_docto === over.id)
    if (oldIdx < 0 || newIdx < 0) return

    const nuevasOrdenes = arrayMove(col.ordenes, oldIdx, newIdx)
    const items = nuevasOrdenes.map((o, i) => ({ op_docto: o.op_docto, prioridad: i + 1 }))
    mutPrioridades.mutate({ maquina_id: col.maquina_id, items })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Layers size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Planeación</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Tablero de Planeación</h1>
            </div>

            <div className="flex gap-1 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-1">
              <button
                onClick={() => setTab('timeline')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === 'timeline'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <CalendarDays size={15} />
                Proyección de Entregas
              </button>
              <button
                onClick={() => setTab('kanban')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === 'kanban'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <LayoutGrid size={15} />
                Kanban por Máquina
              </button>
            </div>
          </div>

          {tab === 'timeline' && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setSemana(w => subWeeks(w, 1))}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="text-center px-6 py-3 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 min-w-[260px]">
                <p className="text-white font-semibold text-lg capitalize">
                  {format(semana, "'Semana del' dd 'de' MMMM", { locale: es })}
                </p>
                <p className="text-blue-200 text-xs mt-0.5">
                  {format(semana, 'yyyy', { locale: es })} · {format(semana, "dd/MM", { locale: es })} – {format(addWeeks(semana, 1), "dd/MM", { locale: es })}
                </p>
              </div>
              <button
                onClick={() => setSemana(w => addWeeks(w, 1))}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">
        {tab === 'timeline' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <DeliveryTimeline />
          </div>
        )}

        {tab === 'kanban' && isLoading && <Loading label="Cargando tablero..." />}

        {tab === 'kanban' && !isLoading && (
          <>
            {cols.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                <Inbox size={40} className="mx-auto text-slate-200 mb-3" />
                <p className="text-slate-400 font-medium">No hay máquinas con ruta SIESA configurada.</p>
                <p className="text-slate-300 text-sm mt-1">Asigna una ruta SIESA a las máquinas para ver sus órdenes.</p>
              </div>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6">
                {cols.map((col, colIdx) => {
                  const accent = COLUMN_ACCENTS[colIdx % COLUMN_ACCENTS.length]
                  return (
                    <div
                      key={col.maquina_id}
                      className="shrink-0 w-80 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col"
                    >
                      <div className={`h-1 ${accent.bar}`} />

                      <div className="p-4 flex-1 flex flex-col">
                        <div className="flex items-center gap-2 mb-4">
                          <div className={`w-8 h-8 rounded-lg ${accent.iconBg} flex items-center justify-center flex-shrink-0`}>
                            <Factory size={15} className={accent.iconText} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide truncate">
                              {col.maquina_nombre}
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                              {col.capacidad_hora.toLocaleString()} uds/hora
                              {col.rutas_siesa && <span className="ml-1">· {col.rutas_siesa}</span>}
                            </p>
                          </div>
                          <span className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 text-xs font-bold">
                            {col.ordenes.length}
                          </span>
                        </div>

                        <DndContext collisionDetection={closestCenter} onDragEnd={e => handleDragEnd(e, col)}>
                          <SortableContext items={col.ordenes.map(o => o.op_docto)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2 flex-1 max-h-[640px] overflow-y-auto pr-1 -mr-1">
                              {col.ordenes.map(o => (
                                <SortableCard
                                  key={o.op_docto}
                                  orden={o}
                                  onCerrar={(op) => mutCerrar.mutate(op)}
                                  cerrando={cerrandoOp === o.op_docto}
                                />
                              ))}
                              {col.ordenes.length === 0 && (
                                <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-400 text-xs">
                                  Sin órdenes asignadas
                                </div>
                              )}
                            </div>
                          </SortableContext>
                        </DndContext>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
