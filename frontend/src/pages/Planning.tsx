import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getBoard, bulkPrioridades, suspenderOrden, reordenarPorFecha } from '../api/planning'
import { format, startOfWeek, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  GripVertical, Pause, LayoutGrid, CalendarDays,
  Layers, Factory, Package, Clock, Inbox, X, CalendarClock,
} from 'lucide-react'
import DeliveryTimeline from '../components/DeliveryTimeline'
import Loading from '../components/Loading'

type OrdenCard = {
  id: number; op_docto: number; maquina_id: number; item?: string; marca?: string
  calibre?: string; fecha_entrega?: string
  cantidad?: number; cant_consumida?: number; estado_op?: string; pct_completado?: number
  horas_estimadas?: number; suspendida: boolean; prioridad: number
}

function SortableCard({ orden, onSuspender }: { orden: OrdenCard; onSuspender: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: orden.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const estadoColor: Record<string, string> = {
    'Completado': 'bg-emerald-100 text-emerald-700',
    'En proceso': 'bg-blue-100 text-blue-700',
    'Pendiente':  'bg-slate-100 text-slate-600',
  }

  const fechaEntrega = orden.fecha_entrega
    ? format(parseISO(orden.fecha_entrega), "d MMM yyyy", { locale: es })
    : null

  const handleMouseEnter = () => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setPreviewPos({ top: rect.top, left: rect.right + 8 })
    }
  }

  const dragClasses = isDragging
    ? 'ring-2 ring-blue-400 shadow-lg rotate-1'
    : 'hover:shadow-md hover:-translate-y-0.5'

  const suspendClasses = orden.suspendida
    ? 'opacity-60 border-amber-300 bg-amber-50/40'
    : 'border-slate-200'

  return (
    <div
      ref={el => { setNodeRef(el); (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el }}
      style={style}
      className={`bg-white rounded-xl border ${suspendClasses} p-3 shadow-sm transition-all cursor-grab ${dragClasses}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setPreviewPos(null)}
    >
      {previewPos && (
        <div
          className="fixed z-[9999] w-60 bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs pointer-events-none"
          style={{ top: previewPos.top, left: previewPos.left }}
        >
          <p className="font-bold text-slate-700 mb-2 uppercase tracking-wide text-[10px]">Detalle OP</p>
          <div className="space-y-1.5">
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">OP</span><span className="font-medium text-slate-800">{orden.op_docto}</span></div>
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">Item</span><span className="font-medium text-slate-800 break-words">{orden.item || '—'}</span></div>
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">Marca</span><span className="font-medium text-slate-800">{orden.marca || '—'}</span></div>
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">Calibre</span><span className="font-medium text-slate-800">{orden.calibre || '—'}</span></div>
            <div className="flex gap-1"><span className="text-slate-400 w-20 shrink-0">Entrega</span><span className={`font-medium ${fechaEntrega ? 'text-slate-800' : 'text-slate-400'}`}>{fechaEntrega || '—'}</span></div>
          </div>
        </div>
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
        {!orden.suspendida && (
          <button
            onClick={() => onSuspender(orden.id)}
            className="text-slate-300 hover:text-amber-500 transition-colors mt-1"
            title="Suspender"
          >
            <Pause size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

type Columna = {
  maquina_id: number; maquina_nombre: string; capacidad_hora: number
  ordenes: OrdenCard[]
}

// Rotating color palette for kanban columns
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
  const { data, isLoading } = useQuery({ queryKey: ['board'], queryFn: () => getBoard() })

  const [tab, setTab] = useState<'kanban' | 'timeline'>('timeline')
  const [suspendiendo, setSuspendiendo] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')

  const cols: Columna[] = data?.columnas ?? []

  const mutPrioridades = useMutation({
    mutationFn: bulkPrioridades,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board'] }),
  })

  const mutSuspender = useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo: string }) => suspenderOrden(id, motivo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['board'] }); setSuspendiendo(null); setMotivo('') },
  })

  const mutReordenar = useMutation({
    mutationFn: (maquina_id: number) => reordenarPorFecha(maquina_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board'] }),
  })

  const handleDragEnd = (event: DragEndEvent, col: Columna, colIdx: number) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = col.ordenes.findIndex(o => o.id === active.id)
    const newIdx = col.ordenes.findIndex(o => o.id === over.id)
    const nuevasOrdenes = arrayMove(col.ordenes, oldIdx, newIdx)

    const newCols = [...cols]
    newCols[colIdx] = { ...col, ordenes: nuevasOrdenes }

    const items = nuevasOrdenes.map((o, i) => ({ asignacion_id: o.id, prioridad: i + 1 }))
    mutPrioridades.mutate(items)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top gradient hero ── */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Layers size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Planeación</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Tablero de Planeación</h1>
              <p className="text-blue-200 text-sm mt-1 capitalize">
                {format(startOfWeek(new Date(), { weekStartsOn: 1 }), "'Semana del' dd 'de' MMMM yyyy", { locale: es })}
              </p>
            </div>

            {/* Tabs — glass style */}
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
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">

        {/* Modal suspender */}
        {suspendiendo && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                    <Pause size={18} className="text-amber-600" />
                  </div>
                  <h3 className="font-bold text-slate-800">Suspender orden</h3>
                </div>
                <button
                  onClick={() => setSuspendiendo(null)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <textarea
                className="w-full border border-slate-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400 text-slate-700"
                rows={3}
                placeholder="Motivo de suspensión..."
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setSuspendiendo(null)}
                  className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => mutSuspender.mutate({ id: suspendiendo, motivo })}
                  disabled={!motivo.trim()}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors"
                >
                  Suspender
                </button>
              </div>
            </div>
          </div>
        )}

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
                <p className="text-slate-400 font-medium">No hay asignaciones para esta semana.</p>
                <p className="text-slate-300 text-sm mt-1">Asigna órdenes desde la página de Órdenes.</p>
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
                      {/* Colored top border */}
                      <div className={`h-1 ${accent.bar}`} />

                      <div className="p-4 flex-1 flex flex-col">
                        {/* Column header */}
                        <div className="flex items-center gap-2 mb-4">
                          <div className={`w-8 h-8 rounded-lg ${accent.iconBg} flex items-center justify-center flex-shrink-0`}>
                            <Factory size={15} className={accent.iconText} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide truncate">
                              {col.maquina_nombre}
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {col.capacidad_hora.toLocaleString()} uds/hora
                            </p>
                          </div>
                          <button
                            onClick={() => mutReordenar.mutate(col.maquina_id)}
                            disabled={mutReordenar.isPending}
                            title="Reordenar por fecha de creación (más antigua primero)"
                            className="text-slate-300 hover:text-blue-500 transition-colors disabled:opacity-40"
                          >
                            <CalendarClock size={14} />
                          </button>
                          <span className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 text-xs font-bold">
                            {col.ordenes.length}
                          </span>
                        </div>

                        <DndContext collisionDetection={closestCenter} onDragEnd={e => handleDragEnd(e, col, colIdx)}>
                          <SortableContext items={col.ordenes.map(o => o.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2 flex-1 max-h-[640px] overflow-y-auto pr-1 -mr-1">
                              {col.ordenes.map(o => (
                                <SortableCard key={o.id} orden={o} onSuspender={setSuspendiendo} />
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
