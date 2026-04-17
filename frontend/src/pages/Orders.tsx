import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, subMonths } from 'date-fns'
import { getOrders, getRegistros, createRegistro, getCenters, getOperarios } from '../api/production'
import { Search, Plus, X, ChevronDown, Check } from 'lucide-react'

type Orden = {
  Id: number; docto: number; item: string; marca?: string; lote?: string
  cantidad?: number; cant_consumida?: number; estado: string; pct_completado: number
  und_medida?: string; created_at?: string; ext1?: string; ext2?: string
}
type Registro = {
  Id: number; fecha: string; maquina: number; maquina_nombre?: string
  numero_op: number; item?: string; operario: number; operario_nombre?: string
  produccion: number; clase_b?: number; desecho?: number
  lider_turno: number; lider_nombre?: string; lote?: string; kg_lote?: number
}
type Maquina = { Id: number; nombre: string }
type Operario = { Id: number; nombre_operario: string; cargo?: number; cargo_nombre?: string }

const ESTADO_COLOR: Record<string, string> = {
  'Completado': 'bg-green-100 text-green-700',
  'En proceso': 'bg-blue-100 text-blue-700',
  'Pendiente':  'bg-gray-100 text-gray-500',
}

const INPUT = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

type Option = { value: string | number; label: string; sub?: string; searchText?: string }

function SearchableSelect({
  value, onChange, options, placeholder = 'Seleccionar...', emptyText = 'Sin coincidencias', disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: Option[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => { if (!open) setSearch('') }, [open])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? options.filter(o => {
        const hay = (o.searchText ?? `${o.label} ${o.sub ?? ''}`).toLowerCase()
        return hay.includes(q)
      })
    : options

  const selected = options.find(o => String(o.value) === value)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`${INPUT} bg-white flex items-center justify-between text-left disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className={`truncate ${selected ? 'text-gray-800' : 'text-gray-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-72 flex flex-col overflow-hidden">
          <div className="p-2 border-b bg-gray-50">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full border rounded pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="p-3 text-xs text-gray-400 text-center">{emptyText}</div>
            ) : filtered.map(o => {
              const isSel = String(o.value) === value
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(String(o.value)); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-start gap-2 hover:bg-blue-50 transition ${isSel ? 'bg-blue-50' : ''}`}
                >
                  <Check size={14} className={`mt-0.5 flex-shrink-0 ${isSel ? 'text-blue-600' : 'text-transparent'}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate ${isSel ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>{o.label}</div>
                    {o.sub && <div className="text-xs text-gray-500 truncate">{o.sub}</div>}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="px-3 py-1.5 border-t bg-gray-50 text-xs text-gray-500">
            {filtered.length} de {options.length}
          </div>
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
  // Cargamos TODAS las OPs de una vez (hasta 2000) para filtrar localmente.
  // Así el buscador encuentra coincidencias en cualquier columna sin depender del backend.
  const { data: ordersData, isLoading: opsLoading } = useQuery({
    queryKey: ['orders-modal-all'],
    queryFn: () => getOrders({ page: 1, page_size: 2000 }),
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
    const extras = [o.marca, o.ext1, o.lote ? `Lote ${o.lote}` : null].filter(Boolean).join(' · ')
    return {
      value: o.docto,
      label: `OP ${o.docto} — ${o.item}`,
      sub: extras || undefined,
      searchText: [o.docto, o.item, o.marca, o.ext1, o.ext2, o.lote, o.und_medida].filter(Boolean).join(' '),
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

  const canSubmit = form.maquina && form.numero_op && form.operario && form.lider_turno && Number(form.produccion) > 0

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-800">Registrar Producción</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          <Field label="Fecha y hora" required>
            <input type="datetime-local" className={INPUT} value={form.fecha}
              onChange={e => set('fecha', e.target.value)} />
          </Field>

          <Field label="Orden de Producción (OP)" required>
            <SearchableSelect
              value={form.numero_op}
              onChange={v => set('numero_op', v)}
              options={opOptions}
              placeholder={opsLoading ? 'Cargando órdenes...' : `Seleccionar OP (${opOptions.length} disponibles)...`}
              emptyText="Sin coincidencias. Prueba con item, marca, referencia, OP o lote."
              disabled={opsLoading}
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
            <Field label="Lote (opcional)">
              <input className={INPUT} value={form.lote} onChange={e => set('lote', e.target.value)} />
            </Field>
            <Field label="KG Lote (opcional)">
              <input type="number" min="0" className={INPUT} value={form.kg_lote}
                onChange={e => set('kg_lote', e.target.value)} />
            </Field>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || mutCreate.isPending}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {mutCreate.isPending ? 'Guardando...' : 'Guardar Registro'}
          </button>
          {mutCreate.isError && (
            <p className="text-red-500 text-xs text-center">Error al guardar. Verifique los datos.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Orders() {
  const [tab, setTab] = useState<'ordenes' | 'registros'>('registros')
  const [buscar, setBuscar] = useState('')
  const [estado, setEstado] = useState('')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [mesesAtras, setMesesAtras] = useState(2)
  const [regBuscar, setRegBuscar] = useState('')

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
  const { data: regData, isLoading: regLoading } = useQuery({
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

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">Registros de Producción</h2>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
        >
          <Plus size={16} /> Registrar Producción
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: 'registros', label: `Registros${regTotal > 0 ? ` (${regTotal})` : ''}` },
          { key: 'ordenes',   label: 'Órdenes' },
        ].map(t => (
          <button key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition
              ${tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ordenes' && (
        <>
          <div className="flex gap-2 flex-wrap items-center">
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                value={buscar} onChange={e => setBuscar(e.target.value)}
                placeholder="Buscar por item, marca o OP..."
                className="border rounded-lg px-3 py-2 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button type="submit" className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                <Search size={16} />
              </button>
            </form>
            {['', 'Pendiente', 'En proceso', 'Completado'].map(e => (
              <button key={e}
                onClick={() => setEstado(e)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition
                  ${estado === e ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}>
                {e || 'Todos'}
              </button>
            ))}
            <span className="text-sm text-gray-400 self-center">{filtradas.length} de {total}</span>
          </div>

          {isLoading && <p className="text-gray-400 text-sm">Cargando...</p>}

          <div className="overflow-x-auto rounded-xl shadow-sm border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">OP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Producto</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Marca</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Lote</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cantidad</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Consumida</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Creado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtradas.map(o => (
                  <tr key={o.Id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-bold text-gray-700">{o.docto}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-gray-800">{o.item}</td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{o.marca || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs hidden md:table-cell">{o.lote || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{o.cantidad?.toLocaleString()} {o.und_medida}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{(o.cant_consumida || 0).toLocaleString()}</span>
                        {o.pct_completado > 0 && (
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500" style={{ width: `${o.pct_completado}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${ESTADO_COLOR[o.estado] || ''}`}>
                        {o.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">
                      {o.created_at ? format(new Date(o.created_at), 'dd/MM/yy') : '—'}
                    </td>
                  </tr>
                ))}
                {filtradas.length === 0 && !isLoading && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Sin órdenes</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {total > 50 && (
            <div className="flex items-center justify-center gap-4">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">Anterior</button>
              <span className="text-sm text-gray-500">Página {page} de {Math.ceil(total / 50)}</span>
              <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40">Siguiente</button>
            </div>
          )}
        </>
      )}

      {tab === 'registros' && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="relative w-full sm:w-80">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={regBuscar}
                onChange={e => setRegBuscar(e.target.value)}
                placeholder="Buscar en cualquier columna..."
                className="w-full border rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {regBuscar && (
                <button
                  onClick={() => setRegBuscar('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Limpiar búsqueda"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {regLoading
                ? 'Cargando...'
                : regBuscar.trim()
                  ? `${regFiltrados.length} de ${regTotal} registros — del ${format(subMonths(today, mesesAtras), 'dd/MM/yyyy')} al ${format(today, 'dd/MM/yyyy')}`
                  : `${regTotal} registros — del ${format(subMonths(today, mesesAtras), 'dd/MM/yyyy')} al ${format(today, 'dd/MM/yyyy')}`
              }
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl shadow-sm border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Fecha', 'Hora', 'OP / Producto', 'Máquina', 'Operario', 'Producción', 'Clase B', 'Desecho'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {regFiltrados.map(r => (
                  <tr key={r.Id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                      {format(new Date(r.fecha), 'dd/MM/yy')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                      {format(new Date(r.fecha), 'HH:mm')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-700">OP {r.numero_op}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[180px]">{r.item}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.maquina_nombre}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{r.operario_nombre}</td>
                    <td className="px-4 py-3 font-bold text-blue-700">{r.produccion.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500">{r.clase_b ?? 0}</td>
                    <td className="px-4 py-3 text-red-500">{r.desecho ?? 0}</td>
                  </tr>
                ))}
                {regFiltrados.length === 0 && !regLoading && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    {regBuscar.trim() ? 'Sin coincidencias para la búsqueda' : 'Sin registros en este período'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-center pt-2">
            <button
              onClick={() => setMesesAtras(m => m + 1)}
              disabled={regLoading}
              className="flex items-center gap-2 px-5 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition"
            >
              <ChevronDown size={16} />
              Ver mes anterior ({format(subMonths(today, mesesAtras + 1), 'MM/yyyy')})
            </button>
          </div>
        </>
      )}

      {showModal && <RegistroModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
