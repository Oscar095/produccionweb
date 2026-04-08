import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getBoard, bulkPrioridades, suspenderOrden } from '../api/planning'
import { format, startOfWeek } from 'date-fns'
import { GripVertical, Pause } from 'lucide-react'

type OrdenCard = {
  id: number; op_docto: number; maquina_id: number; item?: string; marca?: string
  cantidad?: number; cant_consumida?: number; estado_op?: string; pct_completado?: number
  horas_estimadas?: number; suspendida: boolean; prioridad: number
}

function SortableCard({ orden, onSuspender }: { orden: OrdenCard; onSuspender: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: orden.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const estadoColor: Record<string, string> = {
    'Completado': 'bg-green-100 text-green-700',
    'En proceso': 'bg-blue-100 text-blue-700',
    'Pendiente':  'bg-gray-100 text-gray-600',
  }

  return (
    <div ref={setNodeRef} style={style} className={`bg-white rounded-xl border shadow-sm p-3 ${orden.suspendida ? 'opacity-60 border-yellow-300' : ''}`}>
      <div className="flex items-start gap-2">
        <button {...attributes} {...listeners} className="mt-1 text-gray-300 hover:text-gray-500 cursor-grab">
          <GripVertical size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-gray-500">OP {orden.op_docto}</span>
            {orden.estado_op && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoColor[orden.estado_op] || 'bg-gray-100'}`}>
                {orden.estado_op}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-800 truncate mt-0.5">{orden.item}</p>
          {orden.marca && <p className="text-xs text-gray-400 truncate">{orden.marca}</p>}
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span>{orden.cantidad?.toLocaleString()} uds</span>
            {orden.horas_estimadas && <span>{orden.horas_estimadas.toFixed(1)}h est.</span>}
          </div>
          {(orden.pct_completado ?? 0) > 0 && (
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${orden.pct_completado}%` }} />
            </div>
          )}
        </div>
        {!orden.suspendida && (
          <button onClick={() => onSuspender(orden.id)} className="text-gray-300 hover:text-yellow-500 transition mt-1" title="Suspender">
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

export default function Planning() {
  const qc = useQueryClient()
  const semana = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd'T'00:00:00")
  const { data, isLoading } = useQuery({ queryKey: ['board', semana], queryFn: () => getBoard({ semana }) })

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

  if (isLoading) return <p className="p-6 text-gray-400">Cargando tablero...</p>

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Tablero de Planeación</h2>

      {/* Modal suspender */}
      {suspendiendo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96">
            <h3 className="font-bold text-gray-800 mb-3">Suspender orden</h3>
            <textarea
              className="w-full border rounded-lg p-3 text-sm resize-none"
              rows={3} placeholder="Motivo de suspensión..."
              value={motivo} onChange={e => setMotivo(e.target.value)}
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setSuspendiendo(null)}
                className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={() => mutSuspender.mutate({ id: suspendiendo, motivo })}
                disabled={!motivo.trim()}
                className="flex-1 bg-yellow-500 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
                Suspender
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {cols.map((col, colIdx) => (
          <div key={col.maquina_id} className="shrink-0 w-72 bg-gray-100 rounded-2xl p-3">
            <div className="mb-3">
              <h3 className="font-bold text-gray-800 text-sm">{col.maquina_nombre}</h3>
              <p className="text-xs text-gray-500">{col.capacidad_hora.toLocaleString()} uds/hora — {col.ordenes.length} órdenes</p>
            </div>
            <DndContext collisionDetection={closestCenter} onDragEnd={e => handleDragEnd(e, col, colIdx)}>
              <SortableContext items={col.ordenes.map(o => o.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {col.ordenes.map(o => (
                    <SortableCard key={o.id} orden={o} onSuspender={setSuspendiendo} />
                  ))}
                  {col.ordenes.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-6">Sin órdenes asignadas</p>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ))}
        {cols.length === 0 && (
          <p className="text-gray-500 text-sm">No hay asignaciones para esta semana.</p>
        )}
      </div>
    </div>
  )
}
