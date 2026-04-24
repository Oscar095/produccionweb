import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTimeline } from '../api/planning'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertCircle, Clock, CheckCircle2, Check } from 'lucide-react'
import Loading from './Loading'

type TimelineOrder = {
  asignacion_id: number | null
  op_docto: number
  item: string
  marca?: string
  calibre?: string
  maquina_nombre?: string | null
  maquina_id?: number | null
  delivery_date: string
  hoy: string
  dias_restantes: number
  estado_op: string
  pct_completado: number
  cantidad: number
  cant_consumida: number
  atrasada: boolean
  por_vencer: boolean
}

function OrderPreview({
  order, pos, onMouseEnter, onMouseLeave,
}: {
  order: TimelineOrder
  pos: { top: number; left: number }
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const fechaEntrega = order.delivery_date
    ? format(parseISO(order.delivery_date), "d MMM yyyy", { locale: es })
    : null

  const handleCumplir = () => {
    // TODO: wire up API call to close/fulfill the OP
    console.log('Cumplir OP', order.op_docto)
  }

  return (
    <div
      className="fixed z-[9999] w-60 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-xs"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="font-bold text-gray-700">Detalle OP</p>
        <button
          onClick={handleCumplir}
          title="Cumplir / cerrar OP"
          className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 hover:bg-green-600 text-white transition shadow-sm"
        >
          <Check size={14} strokeWidth={3} />
        </button>
      </div>
      <div className="space-y-1.5">
        <div className="flex gap-1"><span className="text-gray-400 w-20 shrink-0">OP</span><span className="font-medium text-gray-800">{order.op_docto}</span></div>
        <div className="flex gap-1"><span className="text-gray-400 w-20 shrink-0">Item</span><span className="font-medium text-gray-800 break-words">{order.item || '—'}</span></div>
        <div className="flex gap-1"><span className="text-gray-400 w-20 shrink-0">Marca</span><span className="font-medium text-gray-800">{order.marca || '—'}</span></div>
        <div className="flex gap-1"><span className="text-gray-400 w-20 shrink-0">Calibre</span><span className="font-medium text-gray-800">{order.calibre || '—'}</span></div>
        <div className="flex gap-1"><span className="text-gray-400 w-20 shrink-0">Entrega</span><span className={`font-medium ${fechaEntrega ? 'text-gray-800' : 'text-gray-400'}`}>{fechaEntrega || '—'}</span></div>
      </div>
    </div>
  )
}

function OrderChip({ order, showOriginal }: { order: TimelineOrder; showOriginal?: boolean }) {
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null)
  const chipRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number | null>(null)

  const baseTitle = showOriginal
    ? `Fecha real de entrega: ${order.delivery_date}`
    : undefined

  const cancelHide = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  const scheduleHide = () => {
    cancelHide()
    hideTimer.current = window.setTimeout(() => setPreviewPos(null), 120)
  }

  const handleMouseEnter = () => {
    cancelHide()
    if (chipRef.current) {
      const rect = chipRef.current.getBoundingClientRect()
      const previewWidth = 240
      const viewportWidth = window.innerWidth
      const left = rect.right + previewWidth + 16 > viewportWidth
        ? rect.left - previewWidth - 8
        : rect.right + 8
      setPreviewPos({ top: rect.top, left })
    }
  }

  const hoverProps = {
    ref: chipRef,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: scheduleHide,
  }

  const previewHandlers = {
    onMouseEnter: cancelHide,
    onMouseLeave: scheduleHide,
  }

  if (order.atrasada) {
    return (
      <>
        <div
          {...hoverProps}
          className="rounded-lg border border-red-300 bg-red-50 p-2 cursor-default select-none"
          title={baseTitle ?? `Venció el ${order.delivery_date} (${Math.abs(order.dias_restantes)}d atrás)`}
        >
          <div className="flex items-center gap-1 mb-0.5">
            <AlertCircle size={10} className="text-red-500 shrink-0" />
            <span className="text-xs font-bold text-red-700">OP {order.op_docto}</span>
            <span className="text-xs text-red-400 ml-auto whitespace-nowrap">
              {Math.abs(order.dias_restantes)}d atrás
            </span>
          </div>
          <p className="text-xs text-red-600 truncate leading-tight">{order.item}</p>
          {order.marca && (
            <p className="text-xs text-red-500 truncate leading-tight font-medium">{order.marca}</p>
          )}
          {order.maquina_nombre && (
            <p className="text-xs text-red-400 truncate leading-tight">{order.maquina_nombre}</p>
          )}
          {order.pct_completado > 0 && (
            <div className="mt-1.5 h-1 bg-red-200 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 rounded-full" style={{ width: `${order.pct_completado}%` }} />
            </div>
          )}
        </div>
        {previewPos && <OrderPreview order={order} pos={previewPos} {...previewHandlers} />}
      </>
    )
  }

  if (order.por_vencer) {
    return (
      <>
        <div {...hoverProps} className="rounded-lg border border-yellow-300 bg-yellow-50 p-2 cursor-default select-none">
          <div className="flex items-center gap-1 mb-0.5">
            <Clock size={10} className="text-yellow-600 shrink-0" />
            <span className="text-xs font-bold text-yellow-800">OP {order.op_docto}</span>
            <span className="text-xs text-yellow-500 ml-auto whitespace-nowrap">
              {order.dias_restantes === 0 ? 'HOY' : `${order.dias_restantes}d`}
            </span>
          </div>
          <p className="text-xs text-yellow-700 truncate leading-tight">{order.item}</p>
          {order.marca && (
            <p className="text-xs text-yellow-600 truncate leading-tight font-medium">{order.marca}</p>
          )}
          {order.maquina_nombre && (
            <p className="text-xs text-yellow-500 truncate leading-tight">{order.maquina_nombre}</p>
          )}
          {order.pct_completado > 0 && (
            <div className="mt-1.5 h-1 bg-yellow-200 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${order.pct_completado}%` }} />
            </div>
          )}
        </div>
        {previewPos && <OrderPreview order={order} pos={previewPos} {...previewHandlers} />}
      </>
    )
  }

  return (
    <>
      <div {...hoverProps} className="rounded-lg border border-gray-200 bg-white p-2 cursor-default select-none shadow-sm">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-xs font-bold text-gray-600">OP {order.op_docto}</span>
          <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">{order.dias_restantes}d</span>
        </div>
        <p className="text-xs text-gray-700 truncate leading-tight">{order.item}</p>
        {order.marca && (
          <p className="text-xs text-gray-500 truncate leading-tight font-medium">{order.marca}</p>
        )}
        {order.maquina_nombre && (
          <p className="text-xs text-gray-400 truncate leading-tight">{order.maquina_nombre}</p>
        )}
        {order.pct_completado > 0 && (
          <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${order.pct_completado}%` }} />
          </div>
        )}
      </div>
      {previewPos && <OrderPreview order={order} pos={previewPos} {...previewHandlers} />}
    </>
  )
}

export default function DeliveryTimeline({ weekStart }: { weekStart?: Date }) {
  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['timeline'],
    queryFn: getTimeline,
    refetchInterval: 60_000,
  })

  const allOrders = orders as TimelineOrder[]

  // Determine today from server data (first order's hoy field) or fallback to local
  const serverToday = allOrders.length > 0 ? allOrders[0].hoy : format(new Date(), 'yyyy-MM-dd')
  const todayDate = new Date(serverToday + 'T12:00:00') // noon to avoid TZ edge cases

  // Compute the week to display — use prop if provided, otherwise current week
  const referenceMonday = weekStart ?? startOfWeek(todayDate, { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(referenceMonday, i))
  const currentWeekMonday = startOfWeek(todayDate, { weekStartsOn: 1 })
  const isCurrentWeek = format(referenceMonday, 'yyyy-MM-dd') === format(currentWeekMonday, 'yyyy-MM-dd')

  // Index orders by delivery_date
  const byDate = new Map<string, TimelineOrder[]>()
  for (const o of allOrders) {
    // Overdue orders: on current week → pin to today; on other weeks → separate section
    const key = (o.atrasada && isCurrentWeek) ? serverToday : o.delivery_date
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push(o)
  }

  // Orders due specifically this visible week (for stats)
  const weekStartStr = format(weekDays[0], 'yyyy-MM-dd')
  const weekEndStr = format(weekDays[6], 'yyyy-MM-dd')
  const weekOrders = allOrders.filter(o => !o.atrasada && o.delivery_date >= weekStartStr && o.delivery_date <= weekEndStr)
  const overdueOrders = allOrders.filter(o => o.atrasada)
  const yellowThisWeek = weekOrders.filter(o => o.por_vencer)

  if (isLoading) return <Loading label="Cargando proyección de entregas..." />

  if (error) return <p className="text-red-400 text-sm py-6">Error cargando datos. Verifica que el servidor esté activo.</p>

  return (
    <div>
      {/* Summary strip */}
      <div className="flex flex-wrap gap-2 mb-5">
        {overdueOrders.length > 0 && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">
            <AlertCircle size={14} className="text-red-500" />
            <span className="text-xs font-semibold text-red-700">
              {overdueOrders.length} {overdueOrders.length === 1 ? 'orden atrasada' : 'órdenes atrasadas'}
              {!isCurrentWeek && ' (ver semana actual)'}
            </span>
          </div>
        )}
        {yellowThisWeek.length > 0 && (
          <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-1.5">
            <Clock size={14} className="text-yellow-600" />
            <span className="text-xs font-semibold text-yellow-700">
              {yellowThisWeek.length} vencen esta semana
            </span>
          </div>
        )}
        {overdueOrders.length === 0 && weekOrders.length > 0 && yellowThisWeek.length === 0 && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-1.5">
            <CheckCircle2 size={14} className="text-green-600" />
            <span className="text-xs font-semibold text-green-700">Sin urgencias esta semana</span>
          </div>
        )}
        {allOrders.length === 0 && (
          <span className="text-xs text-gray-400 py-1">No hay órdenes activas en el sistema.</span>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-red-300 bg-red-100 inline-block" />
            Atrasada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-yellow-300 bg-yellow-100 inline-block" />
            ≤ 5 días
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-gray-200 bg-white inline-block" />
            En tiempo
          </span>
        </div>
      </div>

      {/* Week grid — 7 columns */}
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map((day, di) => {
          const key = format(day, 'yyyy-MM-dd')
          const dayOrders = byDate.get(key) ?? []
          const isCurrentDay = key === serverToday

          return (
            <div
              key={di}
              className={`rounded-xl border flex flex-col ${
                isCurrentDay
                  ? 'border-blue-400 ring-1 ring-blue-200'
                  : 'border-gray-200'
              }`}
            >
              {/* Day header */}
              <div
                className={`rounded-t-xl px-2 py-2 text-center border-b ${
                  isCurrentDay
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className={`text-xs font-bold uppercase tracking-wide ${isCurrentDay ? 'text-blue-200' : 'text-gray-400'}`}>
                  {format(day, 'EEE', { locale: es })}
                </div>
                <div className={`text-sm font-bold leading-tight ${isCurrentDay ? 'text-white' : 'text-gray-800'}`}>
                  {format(day, 'd')}
                </div>
                <div className={`text-xs ${isCurrentDay ? 'text-blue-200' : 'text-gray-400'}`}>
                  {format(day, 'MMM', { locale: es })}
                </div>
                {isCurrentDay && (
                  <div className="mt-0.5 text-xs bg-white/20 text-white rounded-full px-2 py-0.5 inline-block font-semibold">
                    Hoy
                  </div>
                )}
              </div>

              {/* Order chips */}
              <div className="p-1.5 space-y-1.5 flex-1 min-h-[80px] bg-white rounded-b-xl">
                {dayOrders.map(o => (
                  <OrderChip key={o.op_docto} order={o} />
                ))}
                {dayOrders.length === 0 && (
                  <div className="h-full flex items-center justify-center">
                    <span className="text-xs text-gray-200">—</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Overdue detail panel (when not on current week) */}
      {!isCurrentWeek && overdueOrders.length > 0 && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={14} className="text-red-500" />
            <span className="text-sm font-semibold text-red-700">
              Órdenes atrasadas (visibles en la semana actual)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {overdueOrders.map(o => (
              <div key={o.op_docto} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs">
                <span className="font-bold text-red-700">OP {o.op_docto}</span>
                <span className="text-red-500 ml-2">{o.item}</span>
                <span className="text-red-400 ml-2">{Math.abs(o.dias_restantes)}d atrás</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
