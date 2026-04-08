import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { getOrders, getRegistros, createRegistro, getCenters, getOperarios } from '../api/production'
import { Search, Plus, X } from 'lucide-react'

type Orden = {
  Id: number; docto: number; item: string; marca?: string; lote?: string
  cantidad?: number; cant_consumida?: number; estado: string; pct_completado: number
  und_medida?: string; created_at?: string
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
const SELECT = `${INPUT} bg-white`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
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
  const [opSearch, setOpSearch] = useState('')
  const [opSearchCommit, setOpSearchCommit] = useState('')

  const { data: ordersData } = useQuery({
    queryKey: ['orders-modal', opSearchCommit],
    queryFn: () => getOrders({ buscar: opSearchCommit || undefined, page: 1, page_size: 20 }),
    enabled: true,
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
          <Field label="Fecha y hora">
            <input type="datetime-local" className={INPUT} value={form.fecha}
              onChange={e => set('fecha', e.target.value)} />
          </Field>

          <Field label="Orden de Producción (OP)">
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  className={INPUT}
                  placeholder="Buscar por item, marca o número..."
                  value={opSearch}
                  onChange={e => setOpSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') setOpSearchCommit(opSearch) }}
                />
                <button onClick={() => setOpSearchCommit(opSearch)}
                  className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
                  <Search size={16} />
                </button>
              </div>
              <select className={SELECT} value={form.numero_op} onChange={e => set('numero_op', e.target.value)}>
                <option value="">Seleccionar OP...</option>
                {orders.map(o => (
                  <option key={o.docto} value={o.docto}>
                    OP {o.docto} — {o.item}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="Máquina">
            <select className={SELECT} value={form.maquina} onChange={e => set('maquina', e.target.value)}>
              <option value="">Seleccionar máquina...</option>
              {maquinas.map(m => (
                <option key={m.Id} value={m.Id}>{m.nombre}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Operario">
              <select className={SELECT} value={form.operario} onChange={e => set('operario', e.target.value)}>
                <option value="">Seleccionar...</option>
                {operarios.map(o => (
                  <option key={o.Id} value={o.Id}>{o.nombre_operario}</option>
                ))}
              </select>
            </Field>
            <Field label="Líder de Turno">
              <select className={SELECT} value={form.lider_turno} onChange={e => set('lider_turno', e.target.value)}>
                <option value="">Seleccionar...</option>
                {operarios.map(o => (
                  <option key={o.Id} value={o.Id}>{o.nombre_operario}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Producción">
              <input type="number" min="0" className={INPUT} value={form.produccion}
                onChange={e => set('produccion', e.target.value)} />
            </Field>
            <Field label="Clase B">
              <input type="number" min="0" className={INPUT} value={form.clase_b}
                onChange={e => set('clase_b', e.target.value)} />
            </Field>
            <Field label="Desecho">
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
  const [tab, setTab] = useState<'ordenes' | 'registros'>('ordenes')
  const [buscar, setBuscar] = useState('')
  const [estado, setEstado] = useState('')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)

  // Órdenes
  const { data, isLoading } = useQuery({
    queryKey: ['orders', search, page],
    queryFn: () => getOrders({ buscar: search || undefined, page, page_size: 50 }),
    enabled: tab === 'ordenes',
  })
  const ordenes: Orden[] = data?.items ?? []
  const total: number = data?.total ?? 0
  const filtradas = estado ? ordenes.filter(o => o.estado === estado) : ordenes

  // Registros de hoy
  const today = format(new Date(), 'yyyy-MM-dd')
  const { data: regData, isLoading: regLoading } = useQuery({
    queryKey: ['registros', today],
    queryFn: () => getRegistros({ fecha: today, page: 1, page_size: 50 }),
    enabled: tab === 'registros',
  })
  const registros: Registro[] = regData?.items ?? []
  const regTotal: number = regData?.total ?? 0

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(buscar)
    setPage(1)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">Órdenes de Producción</h2>
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
          { key: 'ordenes',   label: 'Órdenes' },
          { key: 'registros', label: `Registros de Hoy${regTotal > 0 ? ` (${regTotal})` : ''}` },
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
                className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400"
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

          <div className="bg-white rounded-xl shadow-sm overflow-hidden border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['OP', 'Producto', 'Marca', 'Lote', 'Cantidad', 'Consumida', 'Estado', 'Creado'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtradas.map(o => (
                  <tr key={o.Id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-bold text-gray-700">{o.docto}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate text-gray-800">{o.item}</td>
                    <td className="px-4 py-3 text-gray-500">{o.marca || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{o.lote || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{o.cantidad?.toLocaleString()} {o.und_medida}</td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3 text-gray-400 text-xs">
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
          <p className="text-sm text-gray-500">{regTotal} registros hoy ({format(new Date(), 'dd/MM/yyyy')})</p>
          {regLoading && <p className="text-gray-400 text-sm">Cargando...</p>}

          <div className="bg-white rounded-xl shadow-sm overflow-hidden border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Hora', 'OP / Producto', 'Máquina', 'Operario', 'Producción', 'Clase B', 'Desecho'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {registros.map(r => (
                  <tr key={r.Id} className="hover:bg-gray-50 transition">
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
                {registros.length === 0 && !regLoading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin registros hoy</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showModal && <RegistroModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
