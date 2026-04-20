import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  getTickets, getTicket, createTicket, updateTicket,
  getBitacora, createBitacora, getRepuestos, getCatalogos,
} from '../api/maintenance'
import { getCenters, getOperarios } from '../api/production'
import {
  AlertTriangle, CheckCircle, XCircle, Clock, Plus, X, ChevronRight, ChevronDown,
  Wrench, Activity, Timer, Gauge, Search, Factory, Calendar, ListChecks,
} from 'lucide-react'
import Loading from '../components/Loading'

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
  1: { label: 'En proceso',  color: 'bg-rose-100 text-rose-700',       Icon: AlertTriangle },
  2: { label: 'Solucionado', color: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle },
  3: { label: 'Cancelado',   color: 'bg-slate-100 text-slate-500',     Icon: XCircle },
}

const INPUT = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm'
const SELECT = `${INPUT} bg-white`
const TEXTAREA = `${INPUT} resize-none`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
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
        <p className="text-2xl font-bold text-slate-800 leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
      <div className={`absolute -right-4 -bottom-4 w-20 h-20 rounded-full opacity-10 ${accent}`} />
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
        className={`${INPUT} cursor-pointer flex items-center justify-between`}
        onClick={() => setOpen(v => !v)}
      >
        <span className={selected ? 'text-slate-700' : 'text-slate-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className="text-slate-400 shrink-0" />
      </div>
      {open && (
        <div className="absolute z-50 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-60 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className={`${INPUT} pl-8`}
                placeholder="Buscar..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="overflow-y-auto">
            <div
              className="px-3 py-2 text-sm text-slate-400 hover:bg-slate-50 cursor-pointer"
              onClick={() => { onChange(''); setSearch(''); setOpen(false) }}
            >
              {placeholder}
            </div>
            {filtered.map(o => (
              <div
                key={o.value}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 ${o.value === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}
                onClick={() => { onChange(o.value); setSearch(''); setOpen(false) }}
              >
                {o.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-slate-400 text-center">Sin resultados</div>
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
      color: 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 disabled:opacity-40',
    },
    {
      tipo: 'Pruebas Aprobadas',
      label: 'Pruebas Aprobadas',
      desc: 'Pruebas aprobadas. Máquina lista para producción',
      enabled: hasEnPruebas && !hasResult,
      color: 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100 disabled:opacity-40',
    },
    {
      tipo: 'Pruebas Rechazadas',
      label: 'Pruebas Rechazadas',
      desc: 'Pruebas rechazadas. Máquina requiere intervención adicional',
      enabled: hasEnPruebas && !hasResult,
      color: 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100 disabled:opacity-40',
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
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl px-12 py-10 min-w-[320px] shadow-2xl">
          <Loading label="Cargando ticket..." fullPanel={false} />
        </div>
      </div>
    )
  }

  const cfg = ESTADO_CONFIG[ticket.row_estado ?? 1]

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-end z-50">
      <div className="bg-slate-50 h-full w-full max-w-full md:max-w-xl flex flex-col shadow-2xl overflow-hidden">
        {/* Hero Header */}
        <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-5 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Wrench size={14} className="text-blue-300" />
                <span className="text-blue-300 text-xs font-medium uppercase tracking-widest">Ticket</span>
              </div>
              <h3 className="text-xl font-bold text-white truncate">{ticket.ticket}</h3>
              <p className="text-sm text-blue-200 truncate">{ticket.maquina_nombre}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs px-3 py-1 rounded-full font-bold inline-flex items-center gap-1 ${cfg.color}`}>
                <cfg.Icon size={12} /> {cfg.label}
              </span>
              <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition">
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 -mt-3 pb-6 space-y-4">
          {/* Info del ticket */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ListChecks size={15} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Detalle</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Apertura</p>
                <p className="text-slate-700 font-medium">{format(new Date(ticket.fecha), 'dd/MM/yyyy HH:mm')}</p>
              </div>
              {ticket.fecha_solucion && (
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Cierre</p>
                  <p className="text-emerald-700 font-medium">{format(new Date(ticket.fecha_solucion), 'dd/MM/yyyy HH:mm')}</p>
                </div>
              )}
              {ticket.asunto && (
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Asunto</p>
                  <p className="text-slate-700">{ticket.asunto}</p>
                </div>
              )}
              {ticket.motivo && (
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Motivo</p>
                  <p className="text-slate-700">{ticket.motivo}</p>
                </div>
              )}
            </div>
            {ticket.descripcion_problema && (
              <div className="mt-2 pt-3 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Descripción</p>
                <p className="text-sm text-slate-600">{ticket.descripcion_problema}</p>
              </div>
            )}
          </div>

          {/* Actualizar estado */}
          {ticket.row_estado === 1 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              {!updatingEstado ? (
                <button onClick={() => { setUpdatingEstado(true); setNuevoEstado('2') }}
                  className="text-sm text-blue-600 hover:text-blue-700 font-semibold inline-flex items-center gap-2">
                  <CheckCircle size={15} /> Cambiar estado del ticket
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity size={15} className="text-slate-400" />
                    <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Actualizar estado</span>
                  </div>
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
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleUpdateEstado} disabled={mutUpdate.isPending}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shadow-sm transition">
                      {mutUpdate.isPending ? 'Guardando...' : 'Confirmar'}
                    </button>
                    <button onClick={() => setUpdatingEstado(false)}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bitácora timeline */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ListChecks size={15} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Bitácora ({bitacoras.length})</span>
              </div>
              <button onClick={() => setAddingEntry(v => !v)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-semibold">
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
                  className={`text-xs px-3 py-1.5 rounded-full border font-bold transition ${action.color}`}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Formulario nueva entrada */}
            {addingEntry && (
              <div className="border border-blue-100 rounded-2xl p-4 space-y-3 bg-blue-50/60">
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
                    className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shadow-sm transition">
                    {mutBitacora.isPending ? 'Guardando...' : 'Agregar'}
                  </button>
                  <button onClick={() => setAddingEntry(false)}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="space-y-1">
              {bitacoras.map((b, idx) => (
                <div key={b.Id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 border-2 border-white shadow-sm">
                      <Clock size={13} className="text-blue-600" />
                    </div>
                    {idx < bitacoras.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 my-1" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-500 font-mono font-medium">
                        {format(new Date(b.fecha), 'dd/MM HH:mm')}
                      </span>
                      {b.Tipo && (
                        <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold uppercase tracking-wide">
                          {b.Tipo}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 mt-0.5 font-medium">{b.bitacora}</p>
                    {b.observaciones && <p className="text-xs text-slate-500 mt-0.5">{b.observaciones}</p>}
                    {b.cantidad != null && (
                      <p className="text-xs text-blue-600 mt-1 font-medium">Repuesto: {b.cantidad} unidades usadas</p>
                    )}
                  </div>
                </div>
              ))}
              {bitacoras.length === 0 && (
                <div className="text-center py-6">
                  <ListChecks size={28} className="mx-auto text-slate-200 mb-2" />
                  <p className="text-sm text-slate-400 font-medium">Sin entradas en bitácora</p>
                </div>
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
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Plus size={14} className="text-blue-300" />
                <span className="text-blue-300 text-xs font-medium uppercase tracking-widest">Nuevo</span>
              </div>
              <h3 className="text-xl font-bold text-white">Ticket de Mantenimiento</h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
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
            className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition shadow-sm">
            {mutCreate.isPending ? 'Guardando...' : 'Crear Ticket'}
          </button>
          {mutCreate.isError && <p className="text-rose-600 text-xs text-center font-medium">Error al crear ticket</p>}
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

  // Derived KPIs from current page (preserves data flow; no extra queries)
  const kpiActivos = tickets.filter(t => t.row_estado === 1).length
  const kpiSolucionados = tickets.filter(t => t.row_estado === 2).length
  const kpiHorasParada = tickets.reduce((s, t) => s + (t.horas_parada ?? 0), 0)
  const kpiMaquinas = new Set(tickets.map(t => t.maquina_nombre).filter(Boolean)).size

  const FILTERS = [
    { v: '',  l: 'Todos' },
    { v: '1', l: 'Activos' },
    { v: '2', l: 'Solucionados' },
    { v: '3', l: 'Cancelados' },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top gradient hero ── */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Wrench size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Mantenimiento</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Mantenimiento</h1>
            </div>
            <button
              onClick={() => setShowNuevo(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-xl border border-white/20 transition-all backdrop-blur-sm"
            >
              <Plus size={15} /> Nuevo Ticket
            </button>
          </div>

          {/* Filters inside hero */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {FILTERS.map(opt => {
              const active = estado === opt.v
              return (
                <button key={opt.v}
                  onClick={() => { setEstado(opt.v); setPage(1) }}
                  className={`px-4 py-2 text-sm rounded-xl border transition-all backdrop-blur-sm font-medium
                    ${active
                      ? 'bg-white text-blue-700 border-white shadow-sm'
                      : 'bg-white/10 hover:bg-white/20 text-white border-white/20'}`}>
                  {opt.l}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={<AlertTriangle size={22} className="text-rose-600" />}
            label="Tickets activos"
            value={String(kpiActivos)}
            sub="en proceso en esta página"
            accent="bg-rose-100"
          />
          <KpiCard
            icon={<CheckCircle size={22} className="text-emerald-600" />}
            label="Solucionados"
            value={String(kpiSolucionados)}
            sub="cerrados en esta página"
            accent="bg-emerald-100"
          />
          <KpiCard
            icon={<Timer size={22} className="text-amber-600" />}
            label="Horas parada"
            value={kpiHorasParada.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            sub="acumuladas visibles"
            accent="bg-amber-100"
          />
          <KpiCard
            icon={<Factory size={22} className="text-violet-600" />}
            label="Máquinas"
            value={String(kpiMaquinas)}
            sub={`de ${total} tickets totales`}
            accent="bg-violet-100"
          />
        </div>

        {/* ── Results header ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Gauge size={15} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
              {total} tickets encontrados
            </span>
          </div>
        </div>

        {isLoading && <Loading label="Cargando tickets..." />}

        {/* ── Tickets list ── */}
        {!isLoading && tickets.length > 0 && (
          <div className="space-y-3">
            {tickets.map(t => {
              const cfg = ESTADO_CONFIG[t.row_estado ?? 0] ?? ESTADO_CONFIG[1]
              return (
                <div key={t.Id}
                  onClick={() => setSelectedTicketId(t.Id)}
                  className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:border-blue-200 hover:shadow-md hover:bg-blue-50/20 transition cursor-pointer group">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Factory size={18} className="text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800">{t.maquina_nombre}</p>
                        {t.descripcion_problema && (
                          <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{t.descripcion_problema}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            {t.ticket}
                          </span>
                          <span className={`inline-flex px-3 py-1 text-xs font-bold rounded-full items-center gap-1 ${cfg.color}`}>
                            <cfg.Icon size={12} /> {cfg.label}
                          </span>
                          {t.asunto && (
                            <span className="text-xs text-slate-500 font-medium">{t.asunto}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-500 shrink-0 space-y-1.5">
                      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-lg border border-slate-100">
                        <Calendar size={12} className="text-slate-400" />
                        <span className="font-medium">{format(new Date(t.fecha), 'dd/MM/yyyy HH:mm')}</span>
                      </div>
                      {t.fecha_solucion && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded-lg border border-emerald-100 text-emerald-700">
                          <CheckCircle size={12} />
                          <span className="font-medium">{format(new Date(t.fecha_solucion), 'dd/MM HH:mm')}</span>
                        </div>
                      )}
                      {t.horas_parada != null && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-lg border border-amber-100 text-amber-700">
                          <Timer size={12} />
                          <span className="font-bold">{t.horas_parada}h parada</span>
                        </div>
                      )}
                      <ChevronRight size={16} className="ml-auto text-slate-300 group-hover:text-blue-500 transition" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && tickets.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
            <Wrench size={40} className="mx-auto text-slate-200 mb-3" />
            <p className="text-slate-400 font-medium">No hay tickets para mostrar.</p>
            <p className="text-slate-300 text-sm mt-1">Prueba cambiando el filtro o creando un ticket nuevo.</p>
          </div>
        )}

        {/* ── Pagination ── */}
        {total > 30 && (
          <div className="flex items-center justify-center gap-4 pt-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50 shadow-sm transition">
              Anterior
            </button>
            <span className="text-sm text-slate-500 font-medium">
              Página <span className="text-slate-800 font-bold">{page}</span> de {Math.ceil(total / 30)}
            </span>
            <button disabled={page * 30 >= total} onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 disabled:opacity-40 hover:bg-slate-50 shadow-sm transition">
              Siguiente
            </button>
          </div>
        )}
      </div>

      {selectedTicketId != null && (
        <TicketModal ticketId={selectedTicketId} onClose={() => setSelectedTicketId(null)} />
      )}
      {showNuevo && <NuevoTicketModal onClose={() => setShowNuevo(false)} />}
    </div>
  )
}
