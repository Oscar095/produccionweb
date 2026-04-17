import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  getTickets, getTicket, createTicket, updateTicket,
  getBitacora, createBitacora, getRepuestos, getCatalogos,
} from '../api/maintenance'
import { getCenters, getOperarios } from '../api/production'
import { AlertTriangle, CheckCircle, XCircle, Clock, Plus, X, ChevronRight, ChevronDown } from 'lucide-react'

type Ticket = {
  Id: number; fecha: string; ticket: string
  maquina_nombre?: string; estado_descripcion?: string
  descripcion_problema?: string; motivo?: string; asunto?: string
  row_estado?: number; fecha_solucion?: string; horas_parada?: number
  row_maquina?: number; row_motivo?: number; row_asunto?: number; row_mecanico?: number
}
type BitacoraEntry = {
  Id: number; fecha: string; bitacora: string; observaciones?: string
  Tipo?: string; id_repuesto?: number; cantidad?: number
}
type Repuesto = { Id: number; item: string; existencia?: number; costo_unitario?: number }
type Catalogo = { Id: number; asunto?: string; motivo?: string; estado?: string }
type Maquina = { Id: number; nombre: string }
type Operario = { Id: number; nombre_operario: string }

const ESTADO_CONFIG: Record<number, { label: string; color: string; Icon: React.ElementType }> = {
  1: { label: 'En proceso', color: 'bg-red-100 text-red-700',    Icon: AlertTriangle },
  2: { label: 'Solucionado', color: 'bg-green-100 text-green-700', Icon: CheckCircle },
  3: { label: 'Cancelado',   color: 'bg-gray-100 text-gray-500',   Icon: XCircle },
}

const INPUT = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'
const SELECT = `${INPUT} bg-white`
const TEXTAREA = `${INPUT} resize-none`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function SearchableSelect({ value, onChange, options, placeholder = 'Seleccionar...' }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative">
      <div
        className={`${INPUT} bg-white cursor-pointer flex items-center justify-between`}
        onClick={() => setOpen(v => !v)}
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className="text-gray-400 shrink-0" />
      </div>
      {open && (
        <div className="absolute z-50 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-60 flex flex-col">
          <div className="p-2 border-b">
            <input
              className={INPUT}
              placeholder="Buscar..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="overflow-y-auto">
            <div
              className="px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 cursor-pointer"
              onClick={() => { onChange(''); setSearch(''); setOpen(false) }}
            >
              {placeholder}
            </div>
            {filtered.map(o => (
              <div
                key={o.value}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 ${o.value === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-800'}`}
                onClick={() => { onChange(o.value); setSearch(''); setOpen(false) }}
              >
                {o.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">Sin resultados</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modal: Detalle del Ticket + Bitácora ────────────────────────────────────
function TicketModal({ ticketId, onClose }: { ticketId: number; onClose: () => void }) {
  const qc = useQueryClient()
  const [addingEntry, setAddingEntry] = useState(false)
  const [repSearch, setRepSearch] = useState('')
  const [entryForm, setEntryForm] = useState({
    fecha: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    row_mecanico: '',
    bitacora: '',
    observaciones: '',
    Tipo: '',
    id_repuesto: '',
    cantidad: '',
  })
  const [updatingEstado, setUpdatingEstado] = useState(false)
  const [nuevoEstado, setNuevoEstado] = useState('')
  const [fechaSolucion, setFechaSolucion] = useState('')

  const { data: ticket, isLoading } = useQuery<Ticket>({
    queryKey: ['ticket', ticketId],
    queryFn: () => getTicket(ticketId),
  })
  const { data: bitacoras = [] } = useQuery<BitacoraEntry[]>({
    queryKey: ['bitacora', ticketId],
    queryFn: () => getBitacora(ticketId),
  })
  const { data: repuestos = [] } = useQuery<Repuesto[]>({
    queryKey: ['repuestos', repSearch],
    queryFn: () => getRepuestos(repSearch || undefined),
    enabled: repSearch.length >= 2,
  })
  const { data: operariosModal = [] } = useQuery<Operario[]>({
    queryKey: ['mecanicos'],
    queryFn: () => getOperarios({ mecanicos_only: true }),
  })

  const mutBitacora = useMutation({
    mutationFn: (data: unknown) => createBitacora(ticketId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bitacora', ticketId] })
      setAddingEntry(false)
      setEntryForm({ fecha: format(new Date(), "yyyy-MM-dd'T'HH:mm"), row_mecanico: '', bitacora: '', observaciones: '', Tipo: '', id_repuesto: '', cantidad: '' })
      setRepSearch('')
    },
  })

  const mutUpdate = useMutation({
    mutationFn: (data: unknown) => updateTicket(ticketId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
      setUpdatingEstado(false)
    },
  })

  const hasEnPruebas = bitacoras.some(b => b.Tipo === 'En Pruebas')
  const hasResult    = bitacoras.some(b => b.Tipo === 'Pruebas Aprobadas' || b.Tipo === 'Pruebas Rechazadas')

  const QUICK_ACTIONS = [
    {
      tipo: 'En Pruebas',
      label: 'En Pruebas',
      desc: 'Máquina en pruebas de funcionamiento',
      enabled: !hasEnPruebas && !hasResult,
      color: 'bg-yellow-50 border-yellow-300 text-yellow-800 hover:bg-yellow-100 disabled:opacity-40',
    },
    {
      tipo: 'Pruebas Aprobadas',
      label: 'Pruebas Aprobadas',
      desc: 'Pruebas aprobadas. Máquina lista para producción',
      enabled: hasEnPruebas && !hasResult,
      color: 'bg-green-50 border-green-300 text-green-800 hover:bg-green-100 disabled:opacity-40',
    },
    {
      tipo: 'Pruebas Rechazadas',
      label: 'Pruebas Rechazadas',
      desc: 'Pruebas rechazadas. Máquina requiere intervención adicional',
      enabled: hasEnPruebas && !hasResult,
      color: 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100 disabled:opacity-40',
    },
  ]

  const handleQuickAction = (tipo: string, desc: string) => {
    setEntryForm(f => ({
      ...f,
      Tipo: tipo,
      bitacora: desc,
      fecha: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      row_mecanico: '',
      observaciones: '',
      id_repuesto: '',
      cantidad: '',
    }))
    setAddingEntry(true)
  }

  const setEF = (k: string, v: string) => setEntryForm(f => ({ ...f, [k]: v }))

  const handleAddEntry = () => {
    mutBitacora.mutate({
      fecha: entryForm.fecha,
      row_mecanico: Number(entryForm.row_mecanico),
      bitacora: entryForm.bitacora,
      observaciones: entryForm.observaciones || undefined,
      Tipo: entryForm.Tipo || undefined,
      id_repuesto: entryForm.id_repuesto ? Number(entryForm.id_repuesto) : undefined,
      cantidad: entryForm.cantidad ? Number(entryForm.cantidad) : undefined,
    })
  }

  const handleUpdateEstado = () => {
    const payload: Record<string, unknown> = { row_estado: Number(nuevoEstado) }
    if (fechaSolucion) payload.fecha_solucion = fechaSolucion
    mutUpdate.mutate(payload)
  }

  if (isLoading || !ticket) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 text-gray-400">Cargando...</div>
      </div>
    )
  }

  const cfg = ESTADO_CONFIG[ticket.row_estado ?? 1]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-end z-50">
      <div className="bg-white h-full w-full max-w-full md:max-w-xl flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-800">{ticket.ticket}</h3>
            <p className="text-xs text-gray-500">{ticket.maquina_nombre}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1 ${cfg.color}`}>
              <cfg.Icon size={12} /> {cfg.label}
            </span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Info del ticket */}
          <div className="px-6 py-4 space-y-2 border-b bg-gray-50">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-400">Apertura</p>
                <p className="text-gray-700">{format(new Date(ticket.fecha), 'dd/MM/yyyy HH:mm')}</p>
              </div>
              {ticket.fecha_solucion && (
                <div>
                  <p className="text-xs text-gray-400">Cierre</p>
                  <p className="text-green-700">{format(new Date(ticket.fecha_solucion), 'dd/MM/yyyy HH:mm')}</p>
                </div>
              )}
              {ticket.asunto && <div><p className="text-xs text-gray-400">Asunto</p><p className="text-gray-700">{ticket.asunto}</p></div>}
              {ticket.motivo && <div><p className="text-xs text-gray-400">Motivo</p><p className="text-gray-700">{ticket.motivo}</p></div>}
            </div>
            {ticket.descripcion_problema && (
              <p className="text-sm text-gray-600">{ticket.descripcion_problema}</p>
            )}
          </div>

          {/* Actualizar estado */}
          {ticket.row_estado === 1 && (
            <div className="px-6 py-3 border-b">
              {!updatingEstado ? (
                <button onClick={() => { setUpdatingEstado(true); setNuevoEstado('2') }}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  Cambiar estado del ticket
                </button>
              ) : (
                <div className="space-y-3">
                  <Field label="Nuevo estado">
                    <select className={SELECT} value={nuevoEstado} onChange={e => setNuevoEstado(e.target.value)}>
                      <option value="2">Solucionado</option>
                      <option value="3">Cancelado</option>
                    </select>
                  </Field>
                  {nuevoEstado === '2' && (
                    <Field label="Fecha de solución">
                      <input type="datetime-local" className={INPUT} value={fechaSolucion}
                        onChange={e => setFechaSolucion(e.target.value)} />
                    </Field>
                  )}
                  <div className="flex gap-2">
                    <button onClick={handleUpdateEstado} disabled={mutUpdate.isPending}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {mutUpdate.isPending ? 'Guardando...' : 'Confirmar'}
                    </button>
                    <button onClick={() => setUpdatingEstado(false)}
                      className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bitácora timeline */}
          <div className="px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-700 text-sm">Bitácora ({bitacoras.length})</h4>
              <button onClick={() => setAddingEntry(v => !v)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Plus size={14} /> Agregar entrada
              </button>
            </div>

            {/* Botones de flujo de pruebas */}
            <div className="flex gap-2 flex-wrap">
              {QUICK_ACTIONS.map(action => (
                <button
                  key={action.tipo}
                  disabled={!action.enabled}
                  onClick={() => handleQuickAction(action.tipo, action.desc)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition ${action.color}`}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Formulario nueva entrada */}
            {addingEntry && (
              <div className="border rounded-xl p-4 space-y-3 bg-blue-50">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fecha">
                    <input type="datetime-local" className={INPUT} value={entryForm.fecha}
                      onChange={e => setEF('fecha', e.target.value)} />
                  </Field>
                  <Field label="Tipo">
                    <select className={SELECT} value={entryForm.Tipo} onChange={e => setEF('Tipo', e.target.value)}>
                      <option value="">Actividad</option>
                      <option value="En Pruebas">En Pruebas</option>
                      <option value="Pruebas Aprobadas">Pruebas Aprobadas</option>
                      <option value="Pruebas Rechazadas">Pruebas Rechazadas</option>
                      <option value="Repuesto Usado">Repuesto Usado</option>
                    </select>
                  </Field>
                </div>
                <Field label="Mecánico *">
                  <select className={SELECT} value={entryForm.row_mecanico}
                    onChange={e => setEF('row_mecanico', e.target.value)}>
                    <option value="">Seleccionar mecánico...</option>
                    {operariosModal.map(o => (
                      <option key={o.Id} value={o.Id}>{o.nombre_operario}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Descripción *">
                  <textarea rows={2} className={TEXTAREA} value={entryForm.bitacora}
                    onChange={e => setEF('bitacora', e.target.value)} />
                </Field>
                <Field label="Observaciones">
                  <textarea rows={2} className={TEXTAREA} value={entryForm.observaciones}
                    onChange={e => setEF('observaciones', e.target.value)} />
                </Field>
                <Field label="Buscar repuesto">
                  <input className={INPUT} placeholder="Escriba al menos 2 caracteres..."
                    value={repSearch} onChange={e => setRepSearch(e.target.value)} />
                </Field>
                {repuestos.length > 0 && (
                  <Field label="Repuesto">
                    <select className={SELECT} value={entryForm.id_repuesto}
                      onChange={e => setEF('id_repuesto', e.target.value)}>
                      <option value="">Sin repuesto</option>
                      {repuestos.map(r => (
                        <option key={r.Id} value={r.Id}>
                          {r.item} {r.existencia != null ? `(stock: ${r.existencia})` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {entryForm.id_repuesto && (
                  <Field label="Cantidad usada">
                    <input type="number" min="1" className={INPUT} value={entryForm.cantidad}
                      onChange={e => setEF('cantidad', e.target.value)} />
                  </Field>
                )}
                <div className="flex gap-2">
                  <button onClick={handleAddEntry}
                    disabled={mutBitacora.isPending || !entryForm.bitacora || !entryForm.row_mecanico}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                    {mutBitacora.isPending ? 'Guardando...' : 'Agregar'}
                  </button>
                  <button onClick={() => setAddingEntry(false)}
                    className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="space-y-3">
              {bitacoras.map(b => (
                <div key={b.Id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-1 shrink-0" />
                    <div className="w-0.5 flex-1 bg-gray-100" />
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400 font-mono">
                        {format(new Date(b.fecha), 'dd/MM HH:mm')}
                      </span>
                      {b.Tipo && (
                        <span className="text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded font-medium">
                          {b.Tipo}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 mt-0.5">{b.bitacora}</p>
                    {b.observaciones && <p className="text-xs text-gray-500 mt-0.5">{b.observaciones}</p>}
                    {b.cantidad != null && (
                      <p className="text-xs text-blue-600 mt-0.5">Repuesto: {b.cantidad} unidades usadas</p>
                    )}
                  </div>
                </div>
              ))}
              {bitacoras.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Sin entradas en bitácora</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Nuevo Ticket ─────────────────────────────────────────────────────
function NuevoTicketModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    fecha: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    row_maquina: '',
    row_operario: '',
    row_motivo: '',
    row_asunto: '',
    descripcion_problema: '',
    row_mecanico: '',
  })

  const { data: maquinas = [] } = useQuery<Maquina[]>({
    queryKey: ['centers'],
    queryFn: getCenters,
  })
  const { data: operarios = [] } = useQuery<Operario[]>({
    queryKey: ['operarios'],
    queryFn: () => getOperarios(),
  })
  const { data: mecanicos = [] } = useQuery<Operario[]>({
    queryKey: ['mecanicos'],
    queryFn: () => getOperarios({ mecanicos_only: true }),
  })
  const { data: catalogos } = useQuery({
    queryKey: ['catalogos'],
    queryFn: getCatalogos,
  })

  const mutCreate = useMutation({
    mutationFn: createTicket,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] })
      onClose()
    },
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  const canSubmit = form.row_maquina && form.row_operario && form.row_motivo && form.row_asunto

  const handleSubmit = () => {
    mutCreate.mutate({
      fecha: form.fecha,
      row_maquina: Number(form.row_maquina),
      row_operario: Number(form.row_operario),
      row_motivo: Number(form.row_motivo),
      row_asunto: Number(form.row_asunto),
      descripcion_problema: form.descripcion_problema || undefined,
      row_mecanico: form.row_mecanico ? Number(form.row_mecanico) : undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-800">Nuevo Ticket de Mantenimiento</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          <Field label="Fecha y hora">
            <input type="datetime-local" className={INPUT} value={form.fecha}
              onChange={e => set('fecha', e.target.value)} />
          </Field>

          <Field label="Máquina *">
            <SearchableSelect
              value={form.row_maquina}
              onChange={v => set('row_maquina', v)}
              options={maquinas.map(m => ({ value: String(m.Id), label: m.nombre }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Asunto *">
              <SearchableSelect
                value={form.row_asunto}
                onChange={v => set('row_asunto', v)}
                options={(catalogos?.asuntos ?? []).map((a: Catalogo) => ({ value: String(a.Id), label: a.asunto ?? '' }))}
              />
            </Field>
            <Field label="Motivo *">
              <SearchableSelect
                value={form.row_motivo}
                onChange={v => set('row_motivo', v)}
                options={(catalogos?.motivos ?? []).map((m: Catalogo) => ({ value: String(m.Id), label: m.motivo ?? '' }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Reporta *">
              <SearchableSelect
                value={form.row_operario}
                onChange={v => set('row_operario', v)}
                options={operarios.map(o => ({ value: String(o.Id), label: o.nombre_operario }))}
              />
            </Field>
            <Field label="Mecánico asignado">
              <SearchableSelect
                value={form.row_mecanico}
                onChange={v => set('row_mecanico', v)}
                options={mecanicos.map(o => ({ value: String(o.Id), label: o.nombre_operario }))}
                placeholder="Sin asignar"
              />
            </Field>
          </div>

          <Field label="Descripción del problema">
            <textarea rows={3} className={TEXTAREA} value={form.descripcion_problema}
              onChange={e => set('descripcion_problema', e.target.value)} />
          </Field>

          <button onClick={handleSubmit} disabled={!canSubmit || mutCreate.isPending}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
            {mutCreate.isPending ? 'Guardando...' : 'Crear Ticket'}
          </button>
          {mutCreate.isError && <p className="text-red-500 text-xs text-center">Error al crear ticket</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Página Principal ─────────────────────────────────────────────────────────
export default function Maintenance() {
  const [estado, setEstado] = useState<string>('1')
  const [page, setPage] = useState(1)
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [showNuevo, setShowNuevo] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', estado, page],
    queryFn: () => getTickets({ estado: estado || undefined, page, page_size: 30 }),
  })

  const tickets: Ticket[] = data?.items ?? []
  const total: number = data?.total ?? 0

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">Mantenimiento</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {[{ v: '', l: 'Todos' }, { v: '1', l: 'Activos' }, { v: '2', l: 'Solucionados' }, { v: '3', l: 'Cancelados' }].map(opt => (
              <button key={opt.v}
                onClick={() => { setEstado(opt.v); setPage(1) }}
                className={`px-3 py-1.5 text-sm rounded-lg border transition
                  ${estado === opt.v ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}>
                {opt.l}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowNuevo(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
          >
            <Plus size={16} /> Nuevo Ticket
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500">{total} tickets encontrados</p>
      {isLoading && <p className="text-gray-400 text-sm">Cargando...</p>}

      <div className="space-y-3">
        {tickets.map(t => {
          const cfg = ESTADO_CONFIG[t.row_estado ?? 0] ?? ESTADO_CONFIG[1]
          return (
            <div key={t.Id}
              onClick={() => setSelectedTicketId(t.Id)}
              className="bg-white rounded-xl border shadow-sm p-4 hover:border-blue-200 hover:shadow-md transition cursor-pointer group">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800">{t.maquina_nombre}</p>
                  {t.descripcion_problema && (
                    <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">{t.descripcion_problema}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs font-medium text-gray-500">{t.ticket}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${cfg.color}`}>
                      <cfg.Icon size={12} /> {cfg.label}
                    </span>
                    {t.asunto && <span className="text-xs text-gray-400">{t.asunto}</span>}
                  </div>
                </div>
                <div className="text-right text-xs text-gray-400 shrink-0 space-y-1">
                  <div className="flex items-center gap-1 justify-end">
                    <Clock size={12} />
                    {format(new Date(t.fecha), 'dd/MM/yyyy HH:mm')}
                  </div>
                  {t.fecha_solucion && (
                    <div className="text-green-600">
                      Cerrado: {format(new Date(t.fecha_solucion), 'dd/MM/yyyy HH:mm')}
                    </div>
                  )}
                  {t.horas_parada != null && (
                    <div className="font-medium text-gray-500">{t.horas_parada}h parada</div>
                  )}
                  <ChevronRight size={16} className="ml-auto text-gray-300 group-hover:text-blue-400 transition" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {total > 30 && (
        <div className="flex items-center justify-center gap-4">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">
            Anterior
          </button>
          <span className="text-sm text-gray-500">Página {page} de {Math.ceil(total / 30)}</span>
          <button disabled={page * 30 >= total} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">
            Siguiente
          </button>
        </div>
      )}

      {selectedTicketId != null && (
        <TicketModal ticketId={selectedTicketId} onClose={() => setSelectedTicketId(null)} />
      )}
      {showNuevo && <NuevoTicketModal onClose={() => setShowNuevo(false)} />}
    </div>
  )
}
