import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, subMonths } from 'date-fns'
import { getOrders, getRegistros, createRegistro, getCenters, getOperarios } from '../api/production'
import { triggerRefreshWebhook } from '../api/planning'
import {
  Search, Plus, X, ChevronDown, Check, Loader2,
  ClipboardList, Package, Factory, TrendingUp,
  Clock, CheckCircle2, AlertCircle, Activity,
  Hash, Calendar, User, BarChart3, RefreshCw,
} from 'lucide-react'
import Loading from '../components/Loading'

type Orden = {
  Id: number; docto: number; item: string; marca?: string; lote?: string
  cantidad?: number; cant_consumida?: number; estado: string; pct_completado: number
  und_medida?: string; created_at?: string; ext1?: string; ext2?: string
  ruta_op?: string
}
type Registro = {
  Id: number; fecha: string; maquina: number; maquina_nombre?: string
  numero_op: number; item?: string; marca?: string; operario: number; operario_nombre?: string
  produccion: number; clase_b?: number; desecho?: number
  lider_turno: number; lider_nombre?: string; lote?: string; kg_lote?: number
}
type Maquina = { Id: number; nombre: string }
type Operario = { Id: number; nombre_operario: string; cargo?: number; cargo_nombre?: string }

const ESTADO_PILL: Record<string, string> = {
  'Completado': 'bg-emerald-100 text-emerald-700',
  'En proceso': 'bg-blue-100 text-blue-700',
  'Pendiente':  'bg-amber-100 text-amber-700',
  'Cancelado':  'bg-rose-100 text-rose-700',
}

const INPUT = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm'

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
        {label}
        {required && <span className="text-rose-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

// ── KPI Card (matches Reports aesthetic) ─────────────────────────────────────
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

type Option = { value: string | number; label: string; sub?: string; searchText?: string }

const MAX_VISIBLE = 50

function SearchableSelect({
  value, onChange, options, placeholder = 'Seleccionar...', emptyText = 'Sin coincidencias',
  disabled, onSearchChange, loading, initialPrompt,
}: {
  value: string
  onChange: (v: string) => void
  options: Option[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  onSearchChange?: (q: string) => void
  loading?: boolean
  initialPrompt?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const isRemote = !!onSearchChange

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) {
      setSearch('')
      if (onSearchChange) onSearchChange('')
    }
  }, [open])

  const handleSearch = (val: string) => {
    setSearch(val)
    if (onSearchChange) onSearchChange(val)
  }

  const q = search.trim().toLowerCase()

  const filtered = isRemote
    ? options
    : q
      ? options.filter(o => {
          const hay = (o.searchText ?? `${o.label} ${o.sub ?? ''}`).toLowerCase()
          return hay.includes(q)
        })
      : options

  const visible = filtered.slice(0, MAX_VISIBLE)
  const hiddenCount = filtered.length - visible.length

  const selected = options.find(o => String(o.value) === value)

  const showInitialPrompt = isRemote && !q && options.length === 0 && !loading

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`${INPUT} bg-white flex items-center justify-between text-left disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className={`truncate ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-slate-100 bg-slate-50">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={search}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full border border-slate-200 rounded-lg pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {loading && (
                <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-500 animate-spin" />
              )}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-3 text-xs text-slate-400 text-center">Buscando...</div>
            ) : showInitialPrompt ? (
              <div className="p-3 text-xs text-slate-400 text-center">
                {initialPrompt ?? 'Escribe para buscar...'}
              </div>
            ) : visible.length === 0 ? (
              <div className="p-3 text-xs text-slate-400 text-center">{emptyText}</div>
            ) : (
              <>
                {visible.map(o => {
                  const isSel = String(o.value) === value
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => { onChange(String(o.value)); setOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-start gap-2 hover:bg-blue-50/60 transition ${isSel ? 'bg-blue-50' : ''}`}
                    >
                      <Check size={14} className={`mt-0.5 flex-shrink-0 ${isSel ? 'text-blue-600' : 'text-transparent'}`} />
                      <div className="min-w-0 flex-1">
                        <div className={`truncate ${isSel ? 'font-semibold text-blue-700' : 'text-slate-700'}`}>{o.label}</div>
                        {o.sub && <div className="text-xs text-slate-500 truncate">{o.sub}</div>}
                      </div>
                    </button>
                  )
                })}
                {hiddenCount > 0 && (
                  <div className="p-2 text-xs text-slate-400 text-center border-t border-slate-100">
                    +{hiddenCount} más — refina tu búsqueda
                  </div>
                )}
              </>
            )}
          </div>
          {!showInitialPrompt && !loading && (
            <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
              {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RegistroModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const today = new Date()
  const [form, setForm] = useState({
    fecha: format(today, "yyyy-MM-dd'T'HH:mm"),
    maquina: '',
    numero_op: '',
    operario: '',
    lider_turno: '',
    produccion: '',
    clase_b: '0',
    desecho: '0',
    lote: '',
    kg_lote: '',
  })
  const [selectedOpId, setSelectedOpId] = useState('')
  const [searchOps, setSearchOps] = useState('')
  const { data: ordersData, isLoading: opsLoading } = useQuery({
    queryKey: ['orders-modal', searchOps],
    queryFn: () => getOrders({
      page: 1,
      page_size: searchOps ? 2000 : 100,
      tipo_inv: '1430K.ex',
      buscar: searchOps || undefined,
    }),
  })
  const orders: Orden[] = ordersData?.items ?? []

  const { data: maquinas = [] } = useQuery<Maquina[]>({
    queryKey: ['centers'],
    queryFn: getCenters,
  })
  const { data: operarios = [] } = useQuery<Operario[]>({
    queryKey: ['operarios'],
    queryFn: () => getOperarios(),
  })

  const opOptions: Option[] = orders.map(o => {
    const extras = o.marca ?? undefined
    return {
      value: o.Id,
      label: `OP ${o.docto} — ${o.item}`,
      sub: extras,
      searchText: [String(o.docto), o.item, o.marca, o.ext1, o.ext2, o.lote, o.und_medida].filter(Boolean).join(' '),
    }
  })

  const maquinaOptions: Option[] = maquinas.map(m => ({ value: m.Id, label: m.nombre }))
  const operarioOptions: Option[] = operarios.map(o => ({
    value: o.Id,
    label: o.nombre_operario,
    sub: o.cargo_nombre,
    searchText: `${o.nombre_operario} ${o.cargo_nombre ?? ''} ${o.Id}`,
  }))

  const mutCreate = useMutation({
    mutationFn: createRegistro,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['registros'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['kpis'] })
      onClose()
    },
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = () => {
    mutCreate.mutate({
      fecha: form.fecha,
      maquina: Number(form.maquina),
      numero_op: Number(form.numero_op),
      operario: Number(form.operario),
      lider_turno: Number(form.lider_turno),
      produccion: Number(form.produccion),
      clase_b: Number(form.clase_b),
      desecho: Number(form.desecho),
      lote: form.lote || undefined,
      kg_lote: form.kg_lote ? Number(form.kg_lote) : undefined,
    })
  }

  const selectedMaquina = maquinas.find(m => String(m.Id) === form.maquina)
  const isFlexo = selectedMaquina?.nombre.toUpperCase().includes('FLEXO') ?? false

  const canSubmit =
    form.maquina && form.numero_op && form.operario && form.lider_turno &&
    Number(form.produccion) > 0 &&
    (!isFlexo || (form.lote.trim() !== '' && Number(form.kg_lote) > 0))

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col border border-slate-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white flex-shrink-0 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Plus size={18} className="text-blue-600" />
            </div>
            <h3 className="font-semibold text-slate-800">Registrar Producción</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <Field label="Fecha y hora" required>
            <input type="datetime-local" className={INPUT} value={form.fecha}
              onChange={e => set('fecha', e.target.value)} />
          </Field>

          <Field label="Orden de Producción (OP)" required>
            <SearchableSelect
              value={selectedOpId}
              onChange={v => {
                setSelectedOpId(v)
                const orden = orders.find(o => String(o.Id) === v)
                if (orden) set('numero_op', String(orden.docto))
              }}
              options={opOptions}
              onSearchChange={setSearchOps}
              loading={opsLoading}
              placeholder={opsLoading ? 'Cargando...' : `Seleccionar OP (${opOptions.length} disponibles)...`}
              emptyText="Sin coincidencias."
              initialPrompt="Escribe OP, item, marca o referencia..."
            />
          </Field>

          <Field label="Máquina" required>
            <SearchableSelect
              value={form.maquina}
              onChange={v => set('maquina', v)}
              options={maquinaOptions}
              placeholder="Seleccionar máquina..."
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Operario" required>
              <SearchableSelect
                value={form.operario}
                onChange={v => set('operario', v)}
                options={operarioOptions}
                placeholder="Seleccionar..."
              />
            </Field>
            <Field label="Líder de Turno" required>
              <SearchableSelect
                value={form.lider_turno}
                onChange={v => set('lider_turno', v)}
                options={operarioOptions}
                placeholder="Seleccionar..."
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Producción" required>
              <input type="number" min="0" className={INPUT} value={form.produccion}
                onChange={e => set('produccion', e.target.value)} />
            </Field>
            <Field label="Clase B" required>
              <input type="number" min="0" className={INPUT} value={form.clase_b}
                onChange={e => set('clase_b', e.target.value)} />
            </Field>
            <Field label="Desecho" required>
              <input type="number" min="0" className={INPUT} value={form.desecho}
                onChange={e => set('desecho', e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Lote" required={isFlexo}>
              <input className={INPUT} value={form.lote} onChange={e => set('lote', e.target.value)}
                placeholder={isFlexo ? 'Requerido para FLEXO' : 'Opcional'} />
            </Field>
            <Field label="KG Lote" required={isFlexo}>
              <input type="number" min="0" className={INPUT} value={form.kg_lote}
                onChange={e => set('kg_lote', e.target.value)}
                placeholder={isFlexo ? 'Requerido para FLEXO' : 'Opcional'} />
            </Field>
          </div>
          {isFlexo && (!form.lote.trim() || !Number(form.kg_lote)) && (
            <p className="text-amber-600 text-xs">
              Las máquinas FLEXO requieren Lote y KG Lote para guardar el registro.
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || mutCreate.isPending}
            className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
          >
            {mutCreate.isPending ? 'Guardando...' : 'Guardar Registro'}
          </button>
          {mutCreate.isError && (
            <p className="text-rose-500 text-xs text-center">Error al guardar. Verifique los datos.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Orders() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'ordenes' | 'registros'>('registros')
  const [buscar, setBuscar] = useState('')
  const [estado, setEstado] = useState('')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [mesesAtras, setMesesAtras] = useState(2)
  const [regBuscar, setRegBuscar] = useState('')

  const mutRefresh = useMutation({
    mutationFn: () => triggerRefreshWebhook(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['registros'] })
      qc.invalidateQueries({ queryKey: ['kpis'] })
    },
    onError: () => {
      alert('No se pudo actualizar las órdenes. Intenta de nuevo.')
    },
  })

  // Órdenes
  const { data, isLoading } = useQuery({
    queryKey: ['orders', search, page],
    queryFn: () => getOrders({ buscar: search || undefined, page, page_size: 50 }),
    enabled: tab === 'ordenes',
  })
  const ordenes: Orden[] = data?.items ?? []
  const total: number = data?.total ?? 0
  const filtradas = estado ? ordenes.filter(o => o.estado === estado) : ordenes

  // Registros — últimos N meses
  const today = new Date()
  const fechaFin = format(today, 'yyyy-MM-dd')
  const fechaInicio = format(subMonths(today, mesesAtras), 'yyyy-MM-dd')
  const { data: regData, isLoading: regLoading, isError: regError } = useQuery({
    queryKey: ['registros', fechaInicio, fechaFin],
    queryFn: () => getRegistros({ fecha_inicio: fechaInicio, fecha_fin: fechaFin, page: 1, page_size: 500 }),
    enabled: tab === 'registros',
  })
  const registros: Registro[] = regData?.items ?? []
  const regTotal: number = regData?.total ?? 0

  const regFiltrados = regBuscar.trim()
    ? registros.filter(r => {
        const q = regBuscar.toLowerCase()
        const campos = [
          format(new Date(r.fecha), 'dd/MM/yyyy HH:mm'),
          String(r.numero_op),
          r.item,
          r.maquina_nombre,
          r.operario_nombre,
          r.lider_nombre,
          String(r.produccion),
          String(r.clase_b ?? ''),
          String(r.desecho ?? ''),
          r.lote,
          String(r.kg_lote ?? ''),
        ]
        return campos.some(c => c?.toString().toLowerCase().includes(q))
      })
    : registros

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(buscar)
    setPage(1)
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const ordenesKpis = useMemo(() => {
    const pendientes = ordenes.filter(o => o.estado === 'Pendiente').length
    const enProceso = ordenes.filter(o => o.estado === 'En proceso').length
    const completados = ordenes.filter(o => o.estado === 'Completado').length
    return { total, pendientes, enProceso, completados }
  }, [ordenes, total])

  const registrosKpis = useMemo(() => {
    const totalProduccion = registros.reduce((s, r) => s + (r.produccion || 0), 0)
    const totalClaseB = registros.reduce((s, r) => s + (r.clase_b || 0), 0)
    const totalDesecho = registros.reduce((s, r) => s + (r.desecho || 0), 0)
    const maquinasActivas = new Set(registros.map(r => r.maquina)).size
    return { totalRegistros: regTotal, totalProduccion, totalClaseB, totalDesecho, maquinasActivas }
  }, [registros, regTotal])

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top gradient hero ── */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          {/* Title row */}
          <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ClipboardList size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Gestión</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Órdenes de Producción</h1>
              <p className="text-blue-200 text-sm mt-1">
                Registros y órdenes activas · Supervisión diaria
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => mutRefresh.mutate()}
                disabled={mutRefresh.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-70 disabled:cursor-wait text-white text-sm font-medium rounded-xl transition-all shadow-sm"
              >
                <RefreshCw size={15} className={mutRefresh.isPending ? 'animate-spin' : ''} />
                {mutRefresh.isPending ? 'Actualizando...' : 'Actualizar Órdenes'}
              </button>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-xl border border-white/20 transition-all backdrop-blur-sm"
              >
                <Plus size={15} />
                Registrar Producción
              </button>
            </div>
          </div>

          {/* Tabs — glass style */}
          <div className="flex items-center gap-2">
            {[
              { key: 'registros', label: 'Registros', icon: <Activity size={14} /> },
              { key: 'ordenes',   label: 'Órdenes', icon: <Package size={14} /> },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as typeof tab)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border transition-all backdrop-blur-sm
                  ${tab === t.key
                    ? 'bg-white text-blue-900 border-white shadow-sm'
                    : 'bg-white/10 text-white border-white/20 hover:bg-white/20'}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">

        {tab === 'ordenes' && (
          <>
            {/* ── KPI cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={<Package size={22} className="text-blue-600" />}
                label="Total órdenes"
                value={ordenesKpis.total.toLocaleString()}
                sub="en la base"
                accent="bg-blue-100"
              />
              <KpiCard
                icon={<Clock size={22} className="text-amber-600" />}
                label="Pendientes"
                value={String(ordenesKpis.pendientes)}
                sub="por iniciar"
                accent="bg-amber-100"
              />
              <KpiCard
                icon={<Activity size={22} className="text-violet-600" />}
                label="En proceso"
                value={String(ordenesKpis.enProceso)}
                sub="activas ahora"
                accent="bg-violet-100"
              />
              <KpiCard
                icon={<CheckCircle2 size={22} className="text-emerald-600" />}
                label="Completadas"
                value={String(ordenesKpis.completados)}
                sub="del lote visible"
                accent="bg-emerald-100"
              />
            </div>

            {/* ── Search + filter bar ── */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex gap-3 flex-wrap items-center">
                <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[260px] max-w-md">
                  <div className="relative flex-1">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={buscar} onChange={e => setBuscar(e.target.value)}
                      placeholder="Buscar por item, marca o OP..."
                      className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                    />
                  </div>
                  <button type="submit" className="px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-sm flex items-center gap-2 text-sm font-medium">
                    <Search size={15} />
                    Buscar
                  </button>
                </form>

                <div className="flex flex-wrap gap-2 items-center">
                  {['', 'Pendiente', 'En proceso', 'Completado'].map(e => (
                    <button key={e}
                      onClick={() => setEstado(e)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition
                        ${estado === e
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                      {e || 'Todos'}
                    </button>
                  ))}
                </div>

                <span className="text-xs text-slate-400 ml-auto font-medium">
                  {filtradas.length} de {total}
                </span>
              </div>
            </div>

            {isLoading && <Loading label="Cargando órdenes..." />}

            {/* ── Orders table ── */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center">
                            <Hash size={12} className="text-blue-600" />
                          </div>
                          OP
                        </div>
                      </th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center">
                            <Package size={12} className="text-violet-600" />
                          </div>
                          Producto
                        </div>
                      </th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600 hidden md:table-cell">Marca</th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600 hidden md:table-cell">Lote</th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600 hidden md:table-cell">Ruta OP</th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">Cantidad</th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600 hidden lg:table-cell">Consumida</th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">Estado</th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600 hidden lg:table-cell">
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-slate-400" />
                          Creado
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map((o, idx) => {
                      const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                      return (
                        <tr key={o.Id} className={`border-b border-slate-100 ${rowBg} transition-colors hover:bg-blue-50/40`}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                                <Hash size={13} className="text-blue-600" />
                              </div>
                              <span className="font-bold text-slate-700">{o.docto}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 max-w-[220px] truncate text-slate-800 font-medium">{o.item}</td>
                          <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{o.marca || '—'}</td>
                          <td className="px-5 py-3 text-slate-500 font-mono text-xs hidden md:table-cell">{o.lote || '—'}</td>
                          <td className="px-5 py-3 text-slate-500 font-mono text-xs hidden md:table-cell">{o.ruta_op || '—'}</td>
                          <td className="px-5 py-3 text-slate-700 font-medium">
                            {o.cantidad?.toLocaleString()} <span className="text-xs text-slate-400">{o.und_medida}</span>
                          </td>
                          <td className="px-5 py-3 hidden lg:table-cell">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-700 font-medium">{(o.cant_consumida || 0).toLocaleString()}</span>
                              {o.pct_completado > 0 && (
                                <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
                                    style={{ width: `${o.pct_completado}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${ESTADO_PILL[o.estado] || 'bg-slate-100 text-slate-500'}`}>
                              {o.estado}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-slate-400 text-xs hidden lg:table-cell">
                            {o.created_at ? format(new Date(o.created_at), 'dd/MM/yy') : '—'}
                          </td>
                        </tr>
                      )
                    })}
                    {filtradas.length === 0 && !isLoading && (
                      <tr>
                        <td colSpan={9} className="p-12 text-center">
                          <Package size={40} className="mx-auto text-slate-200 mb-3" />
                          <p className="text-slate-400 font-medium">Sin órdenes para mostrar.</p>
                          <p className="text-slate-300 text-sm mt-1">Prueba ajustando la búsqueda o los filtros.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {total > 50 && (
              <div className="flex items-center justify-center gap-4">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40 transition"
                >
                  Anterior
                </button>
                <span className="text-sm text-slate-500 font-medium">
                  Página <span className="text-slate-800 font-bold">{page}</span> de {Math.ceil(total / 50)}
                </span>
                <button
                  disabled={page * 50 >= total}
                  onClick={() => setPage(p => p + 1)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40 transition"
                >
                  Siguiente
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'registros' && (
          <>
            {/* ── KPI cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={<Activity size={22} className="text-blue-600" />}
                label="Total registros"
                value={registrosKpis.totalRegistros.toLocaleString()}
                sub={`${mesesAtras} ${mesesAtras === 1 ? 'mes' : 'meses'} atrás`}
                accent="bg-blue-100"
              />
              <KpiCard
                icon={<TrendingUp size={22} className="text-emerald-600" />}
                label="Producción total"
                value={registrosKpis.totalProduccion.toLocaleString()}
                sub="unidades válidas"
                accent="bg-emerald-100"
              />
              <KpiCard
                icon={<AlertCircle size={22} className="text-amber-600" />}
                label="Clase B"
                value={registrosKpis.totalClaseB.toLocaleString()}
                sub="unidades segunda"
                accent="bg-amber-100"
              />
              <KpiCard
                icon={<Factory size={22} className="text-violet-600" />}
                label="Máquinas activas"
                value={String(registrosKpis.maquinasActivas)}
                sub="con registros"
                accent="bg-violet-100"
              />
            </div>

            {/* ── Search bar ── */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="relative w-full sm:w-96">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={regBuscar}
                    onChange={e => setRegBuscar(e.target.value)}
                    placeholder="Buscar en cualquier columna..."
                    className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  />
                  {regBuscar && (
                    <button
                      onClick={() => setRegBuscar('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label="Limpiar búsqueda"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  {regLoading
                    ? 'Cargando...'
                    : regBuscar.trim()
                      ? `${regFiltrados.length} de ${regTotal} registros · del ${format(subMonths(today, mesesAtras), 'dd/MM/yyyy')} al ${format(today, 'dd/MM/yyyy')}`
                      : `${regTotal} registros · del ${format(subMonths(today, mesesAtras), 'dd/MM/yyyy')} al ${format(today, 'dd/MM/yyyy')}`
                  }
                </p>
              </div>
            </div>

            {regLoading && <Loading label="Cargando registros..." />}

            {/* ── Registros table ── */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center">
                            <Calendar size={12} className="text-blue-600" />
                          </div>
                          Fecha
                        </div>
                      </th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">
                        <div className="flex items-center gap-2">
                          <Clock size={13} className="text-slate-400" />
                          Hora
                        </div>
                      </th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center">
                            <Package size={12} className="text-violet-600" />
                          </div>
                          OP / Producto
                        </div>
                      </th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center">
                            <Factory size={12} className="text-amber-600" />
                          </div>
                          Máquina
                        </div>
                      </th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">
                        <div className="flex items-center gap-2">
                          <User size={13} className="text-slate-400" />
                          Operario
                        </div>
                      </th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center">
                            <BarChart3 size={12} className="text-emerald-600" />
                          </div>
                          Producción
                        </div>
                      </th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">Clase B</th>
                      <th className="px-5 py-4 text-left font-semibold text-slate-600">Desecho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regFiltrados.map((r, idx) => {
                      const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                      return (
                        <tr key={r.Id} className={`border-b border-slate-100 ${rowBg} transition-colors hover:bg-blue-50/40`}>
                          <td className="px-5 py-3 text-slate-500 text-xs font-mono">
                            {format(new Date(r.fecha), 'dd/MM/yy')}
                          </td>
                          <td className="px-5 py-3 text-slate-500 text-xs font-mono">
                            {format(new Date(r.fecha), 'HH:mm')}
                          </td>
                          <td className="px-5 py-3">
                            <div className="font-semibold text-slate-800 truncate max-w-[200px]">{r.item}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-400 font-mono">OP {r.numero_op}</span>
                              {r.marca && (
                                <span className="text-xs text-violet-600 font-medium">{r.marca}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-slate-700 font-medium">{r.maquina_nombre}</td>
                          <td className="px-5 py-3 text-slate-600 text-xs">{r.operario_nombre}</td>
                          <td className="px-5 py-3">
                            <span className="inline-flex px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                              {r.produccion.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-slate-500 font-medium">{(r.clase_b ?? 0).toLocaleString()}</td>
                          <td className="px-5 py-3">
                            {(r.desecho ?? 0) > 0 ? (
                              <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700">
                                {(r.desecho ?? 0).toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">0</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {regError && (
                      <tr>
                        <td colSpan={8} className="p-12 text-center">
                          <AlertCircle size={40} className="mx-auto text-rose-200 mb-3" />
                          <p className="text-rose-500 font-medium">Error al cargar registros</p>
                          <p className="text-slate-400 text-sm mt-1">Verifica que el backend esté activo.</p>
                        </td>
                      </tr>
                    )}
                    {!regError && regFiltrados.length === 0 && !regLoading && (
                      <tr>
                        <td colSpan={8} className="p-12 text-center">
                          <Activity size={40} className="mx-auto text-slate-200 mb-3" />
                          <p className="text-slate-400 font-medium">
                            {regBuscar.trim() ? 'Sin coincidencias para la búsqueda.' : 'Sin registros en este período.'}
                          </p>
                          <p className="text-slate-300 text-sm mt-1">
                            {regBuscar.trim() ? 'Ajusta los términos de búsqueda.' : 'Prueba cargando un mes anterior.'}
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-center pt-2">
              <button
                onClick={() => setMesesAtras(m => m + 1)}
                disabled={regLoading}
                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40 transition"
              >
                <ChevronDown size={16} />
                Ver mes anterior ({format(subMonths(today, mesesAtras + 1), 'MM/yyyy')})
              </button>
            </div>
          </>
        )}

        {showModal && <RegistroModal onClose={() => setShowModal(false)} />}
      </div>
    </div>
  )
}
