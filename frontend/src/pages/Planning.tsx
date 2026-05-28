import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getKanban, bulkKanbanPrioridades, cerrarOP, resetKanbanPrioridades, triggerRefreshWebhook, toggleKanbanCheck } from '../api/planning'
import { format, startOfWeek, addWeeks, subWeeks, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  GripVertical, LayoutGrid, CalendarDays,
  Layers, Factory, Package, Clock, Inbox,
  ChevronLeft, ChevronRight, CheckCircle2, Loader2, RotateCcw, RefreshCw,
  ListChecks, Search, X,
} from 'lucide-react'
import DeliveryTimeline from '../components/DeliveryTimeline'
import CierreMasivo from '../components/CierreMasivo'
import Loading from '../components/Loading'

type CheckKey = 'impresion' | 'troquelado' | 'formacion' | 'bodega'

type OrdenChecks = Record<CheckKey, boolean>

type OrdenCard = {
  op_docto: number
  item?: string; marca?: string; calibre?: string
  cantidad?: number; cant_consumida?: number
  estado_op?: string; pct_completado?: number
  horas_estimadas?: number
  fecha_entrega?: string
  fecha_entrega_estimada?: string
  created_at?: string
  prioridad?: number | null
  checks?: OrdenChecks
}

const CHECK_FIELDS: { key: CheckKey; label: string; full: string }[] = [
  { key: 'impresion',  label: 'IMP', full: 'Impresión' },
  { key: 'troquelado', label: 'TRO', full: 'Troquelado' },
  { key: 'formacion',  label: 'FOR', full: 'Formación' },
  { key: 'bodega',     label: 'BOD', full: 'Bodega' },
]

type Columna = {
  maquina_id: number
  maquina_nombre: string
  capacidad_hora: number
  rutas_siesa?: string | null
  maquinas_en_ruta?: string[]
  ordenes: OrdenCard[]
}

function SortableCard({
  orden,
  onCerrar,
  cerrando,
  onToggleCheck,
}: {
  orden: OrdenCard
  onCerrar: (op_docto: number) => void
  cerrando: boolean
  onToggleCheck: (op_docto: number, field: CheckKey) => void
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

  const fechaEstimada = orden.fecha_entrega_estimada
    ? format(parseISO(orden.fecha_entrega_estimada), "d MMM yyyy", { locale: es })
    : null

  const vencida = orden.fecha_entrega
    ? parseISO(orden.fecha_entrega).getTime() < Date.now()
    : false

  const clearHide = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
  }

  const handleMouseEnter = () => {
    clearHide()
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      const previewWidth = 256 // w-64
      const left = rect.right + previewWidth + 8 > window.innerWidth
        ? rect.left - previewWidth - 8
        : rect.right + 8
      setPreviewPos({ top: rect.top, left })
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
      className={`rounded-xl border p-3 shadow-sm transition-all cursor-grab ${
        vencida ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'
      } ${dragClasses}`}
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
            {fechaEstimada && (
              <span
                title="Fecha estimada de entrega segun checks de etapas"
                className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 rounded-md px-2 py-0.5 text-[11px] font-medium"
              >
                <CalendarDays size={10} />
                Est. {fechaEstimada}
              </span>
            )}
          </div>
          <div className="flex gap-1 mt-2">
            {CHECK_FIELDS.map(({ key, label, full }) => {
              const active = orden.checks?.[key] ?? false
              return (
                <button
                  key={key}
                  type="button"
                  title={full}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onToggleCheck(orden.op_docto, key) }}
                  className={`flex-1 text-[10px] font-bold px-1.5 py-1 rounded-md transition-colors ${
                    active
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 'bg-slate-200 text-slate-400 hover:bg-slate-300'
                  }`}
                >
                  {label}
                </button>
              )
            })}
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

  const [tab, setTab] = useState<'kanban' | 'timeline' | 'cierre'>('kanban')
  const [searchTerm, setSearchTerm] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['kanban'],
    queryFn: () => getKanban(),
    enabled: tab === 'kanban',
  })

  const cols: Columna[] = data?.columnas ?? []

  const mutPrioridades = useMutation({
    mutationFn: ({ maquina_id, items }: { maquina_id: number; items: Array<{ op_docto: number; prioridad: number }> }) =>
      bulkKanbanPrioridades(maquina_id, items),
    // Optimistic update: aplicar las prioridades nuevas en el cache antes de
    // que el servidor confirme, para que la card no "salte de regreso" entre
    // el drop y el refetch.
    onMutate: async ({ maquina_id, items }) => {
      await qc.cancelQueries({ queryKey: ['kanban'] })
      const previous = qc.getQueryData<{ columnas: Columna[] }>(['kanban'])
      const prioMap = new Map(items.map(i => [i.op_docto, i.prioridad]))
      qc.setQueryData<{ columnas: Columna[] } | undefined>(['kanban'], (old) => {
        if (!old) return old
        return {
          ...old,
          columnas: old.columnas.map(c =>
            c.maquina_id === maquina_id
              ? {
                  ...c,
                  ordenes: c.ordenes.map(o =>
                    prioMap.has(o.op_docto)
                      ? { ...o, prioridad: prioMap.get(o.op_docto)! }
                      : o
                  ),
                }
              : c
          ),
        }
      })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['kanban'], context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['kanban'] }),
  })

  const mutResetPrioridades = useMutation({
    mutationFn: (maquina_id: number) => resetKanbanPrioridades(maquina_id),
    onMutate: async (maquina_id) => {
      await qc.cancelQueries({ queryKey: ['kanban'] })
      const previous = qc.getQueryData<{ columnas: Columna[] }>(['kanban'])
      qc.setQueryData<{ columnas: Columna[] } | undefined>(['kanban'], (old) => {
        if (!old) return old
        return {
          ...old,
          columnas: old.columnas.map(c =>
            c.maquina_id === maquina_id
              ? { ...c, ordenes: c.ordenes.map(o => ({ ...o, prioridad: null })) }
              : c
          ),
        }
      })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['kanban'], context.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['kanban'] }),
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

  const mutToggleCheck = useMutation({
    mutationFn: ({ op_docto, field }: { op_docto: number; field: CheckKey }) =>
      toggleKanbanCheck(op_docto, field),
    onMutate: async ({ op_docto, field }) => {
      await qc.cancelQueries({ queryKey: ['kanban'] })
      const previous = qc.getQueryData<{ columnas: Columna[] }>(['kanban'])
      qc.setQueryData<{ columnas: Columna[] } | undefined>(['kanban'], (old) => {
        if (!old) return old
        return {
          ...old,
          columnas: old.columnas.map(c => ({
            ...c,
            ordenes: c.ordenes.map(o => {
              if (o.op_docto !== op_docto) return o
              const base: OrdenChecks = o.checks ?? { impresion: false, troquelado: false, formacion: false, bodega: false }
              return { ...o, checks: { ...base, [field]: !base[field] } }
            }),
          })),
        }
      })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['kanban'], context.previous)
      alert('No se pudo actualizar el estado. Intenta de nuevo.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['kanban'] }),
  })

  const mutRefresh = useMutation({
    mutationFn: () => triggerRefreshWebhook(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kanban'] })
      qc.invalidateQueries({ queryKey: ['timeline'] })
    },
    onError: () => {
      alert('No se pudo actualizar las órdenes. Intenta de nuevo.')
    },
  })

  const handleDragEnd = (event: DragEndEvent, maquina_id: number, ordenes: OrdenCard[]) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = ordenes.findIndex(o => o.op_docto === active.id)
    const newIdx = ordenes.findIndex(o => o.op_docto === over.id)
    if (oldIdx < 0 || newIdx < 0) return

    const nuevasOrdenes = arrayMove(ordenes, oldIdx, newIdx)
    const items = nuevasOrdenes.map((o, i) => ({ op_docto: o.op_docto, prioridad: i + 1 }))
    mutPrioridades.mutate({ maquina_id, items })
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

            <div className="flex items-center gap-3">
              <div className="flex gap-1 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-1">
                <button
                  onClick={() => setTab('kanban')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    tab === 'kanban'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <LayoutGrid size={15} />
                  Kanban por Ruta
                </button>
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
                  onClick={() => setTab('cierre')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    tab === 'cierre'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <ListChecks size={15} />
                  Cierre Masivo
                </button>
              </div>

              <button
                onClick={() => mutRefresh.mutate()}
                disabled={mutRefresh.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-70 disabled:cursor-wait text-white text-sm font-medium transition-all shadow-sm"
              >
                <RefreshCw size={15} className={mutRefresh.isPending ? 'animate-spin' : ''} />
                {mutRefresh.isPending ? 'Actualizando...' : 'Actualizar Órdenes'}
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
            <DeliveryTimeline weekStart={semana} />
          </div>
        )}

        {tab === 'kanban' && isLoading && <Loading label="Cargando tablero..." />}

        {tab === 'kanban' && !isLoading && (
          <>
            {cols.length > 0 && (
              <div className="relative max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Buscar marca, producto u OP..."
                  className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder:text-slate-400"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            {cols.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                <Inbox size={40} className="mx-auto text-slate-200 mb-3" />
                <p className="text-slate-400 font-medium">No hay rutas SIESA configuradas.</p>
                <p className="text-slate-300 text-sm mt-1">Configura rutas SIESA y asígnalas a las máquinas para ver sus órdenes.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {cols.map((col, colIdx) => {
                  const accent = COLUMN_ACCENTS[colIdx % COLUMN_ACCENTS.length]
                  // Orden default: fecha de terminación más cercana primero (ASC).
                  // Las OPs con prioridad manual (drag & drop) van primero en
                  // orden ascendente. Empates → tiebreaker por fecha de entrega.
                  const ordenesVisibles = [...col.ordenes]
                    .sort((a, b) => {
                      const pa = a.prioridad ?? 9999
                      const pb = b.prioridad ?? 9999
                      if (pa !== pb) return pa - pb
                      const da = a.fecha_entrega ? new Date(a.fecha_entrega).getTime() : Number.POSITIVE_INFINITY
                      const db = b.fecha_entrega ? new Date(b.fecha_entrega).getTime() : Number.POSITIVE_INFINITY
                      return da - db
                    })
                    .filter(o => {
                      if (!searchTerm.trim()) return true
                      const q = searchTerm.toLowerCase().trim()
                      return (
                        o.marca?.toLowerCase().includes(q) ||
                        o.item?.toLowerCase().includes(q) ||
                        String(o.op_docto).includes(q)
                      )
                    })
                  const tienePrioridadManual = col.ordenes.some(o => o.prioridad != null)
                  const reseteandoEsta = mutResetPrioridades.isPending && mutResetPrioridades.variables === col.maquina_id
                  return (
                    <div
                      key={col.maquina_id}
                      className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-w-0"
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
                              {col.capacidad_hora.toLocaleString()} uds/hora total
                            </p>
                            {col.maquinas_en_ruta && col.maquinas_en_ruta.length > 0 && (
                              <p className="text-[10px] text-slate-300 truncate mt-0.5">
                                {col.maquinas_en_ruta.join(' · ')}
                              </p>
                            )}
                          </div>
                          <span className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 text-xs font-bold">
                            {searchTerm.trim()
                              ? `${ordenesVisibles.length}/${col.ordenes.length}`
                              : ordenesVisibles.length}
                          </span>
                          {tienePrioridadManual && (
                            <button
                              type="button"
                              onClick={() => {
                                if (reseteandoEsta) return
                                if (confirm(`¿Restaurar el orden por defecto de "${col.maquina_nombre}"?\nSe perderán las prioridades manuales.`)) {
                                  mutResetPrioridades.mutate(col.maquina_id)
                                }
                              }}
                              disabled={reseteandoEsta}
                              title="Restaurar orden por defecto (fecha de entrega)"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {reseteandoEsta
                                ? <Loader2 size={14} className="animate-spin" />
                                : <RotateCcw size={14} />}
                            </button>
                          )}
                        </div>

                        <DndContext collisionDetection={closestCenter} onDragEnd={e => handleDragEnd(e, col.maquina_id, ordenesVisibles)}>
                          <SortableContext items={ordenesVisibles.map(o => o.op_docto)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2 flex-1 max-h-[520px] overflow-y-auto pr-1 -mr-1">
                              {ordenesVisibles.map(o => (
                                <SortableCard
                                  key={o.op_docto}
                                  orden={o}
                                  onCerrar={(op) => mutCerrar.mutate(op)}
                                  cerrando={cerrandoOp === o.op_docto}
                                  onToggleCheck={(op, field) => mutToggleCheck.mutate({ op_docto: op, field })}
                                />
                              ))}
                              {ordenesVisibles.length === 0 && (
                                <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-400 text-xs">
                                  {searchTerm.trim() ? 'Sin coincidencias' : 'Sin órdenes asignadas'}
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

        {tab === 'cierre' && <CierreMasivo />}
      </div>
    </div>
  )
}
