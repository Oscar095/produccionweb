import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getMaquinas, createMaquina, updateMaquina,
  getCentrosCostos, getEstadosMaquinas,
  getRutasSiesa, createRutaSiesa, updateRutaSiesa,
  getMetas, updateMeta,
} from '../api/config'
import { usePermiso } from '../store/auth'
import { PlusCircle, Pencil, X, Cpu, Route, Settings, Layers, Target, Check } from 'lucide-react'
import Loading from '../components/Loading'

// ─── Types ────────────────────────────────────────────────────────────────────
type Maquina = {
  id: number
  nombre: string
  capacidad_hora: number
  centro_costos_id: number
  centro_costos: string | null
  estado_id: number
  estado_descripcion: string | null
  rutas_siesa_id: number | null
  rutas_siesa_nombre: string | null
  calcula_capacidad: boolean
}
type CentroCostos = { id: number; centro: string }
type EstadoMaquina = { id: number; estado_descripcion: string }
type RutaSiesa = { id: number; nombre_ruta: string; descripcion: string | null; orden: number; activo: boolean }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const INPUT  = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm'
const SELECT = `${INPUT} appearance-none`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col border border-slate-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg p-1 transition"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
      </div>
    </div>
  )
}

// ─── Form de máquina ─────────────────────────────────────────────────────────
type MaquinaForm = { nombre: string; capacidad_hora: string; centro_costos_id: string; estado_id: string; rutas_siesa_id: string; calcula_capacidad: boolean }

const EMPTY_MAQUINA_FORM: MaquinaForm = { nombre: '', capacidad_hora: '', centro_costos_id: '', estado_id: '', rutas_siesa_id: '', calcula_capacidad: true }

function MaquinaFormFields({
  form, onChange, centros, estados, rutas,
}: {
  form: MaquinaForm
  onChange: (f: MaquinaForm) => void
  centros: CentroCostos[]
  estados: EstadoMaquina[]
  rutas: RutaSiesa[]
}) {
  const set = (k: keyof MaquinaForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...form, [k]: e.target.value })

  return (
    <>
      <Field label="Nombre *">
        <input className={INPUT} value={form.nombre} onChange={set('nombre')} placeholder="Ej. Troqueladora #1" />
      </Field>
      <Field label="Capacidad (unidades/hora) *">
        <input type="number" min={1} className={INPUT} value={form.capacidad_hora} onChange={set('capacidad_hora')} />
      </Field>
      <Field label="Centro de costos *">
        <select className={SELECT} value={form.centro_costos_id} onChange={set('centro_costos_id')}>
          <option value="">Seleccionar...</option>
          {centros.map(c => <option key={c.id} value={c.id}>{c.centro}</option>)}
        </select>
      </Field>
      <Field label="Estado *">
        <select className={SELECT} value={form.estado_id} onChange={set('estado_id')}>
          <option value="">Seleccionar...</option>
          {estados.map(e => <option key={e.id} value={e.id}>{e.estado_descripcion}</option>)}
        </select>
      </Field>
      <Field label="Ruta SIESA">
        <select className={SELECT} value={form.rutas_siesa_id} onChange={set('rutas_siesa_id')}>
          <option value="">Sin ruta</option>
          {rutas.filter(r => r.activo).map(r => <option key={r.id} value={r.id}>{r.nombre_ruta}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
        <input
          type="checkbox"
          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
          checked={form.calcula_capacidad}
          onChange={e => onChange({ ...form, calcula_capacidad: e.target.checked })}
        />
        <span className="text-sm font-medium text-slate-600">Calcula capacidad</span>
      </label>
    </>
  )
}

// ─── Tab: Máquinas ────────────────────────────────────────────────────────────
function TabMaquinas() {
  const qc = useQueryClient()
  const permiso = usePermiso('configuracion')

  const { data: maquinas = [], isLoading } = useQuery<Maquina[]>({ queryKey: ['config-maquinas'], queryFn: getMaquinas })
  const { data: centros = [] } = useQuery<CentroCostos[]>({ queryKey: ['config-centros'], queryFn: getCentrosCostos })
  const { data: estados = [] } = useQuery<EstadoMaquina[]>({ queryKey: ['config-estados'], queryFn: getEstadosMaquinas })
  const { data: rutas = [] } = useQuery<RutaSiesa[]>({ queryKey: ['config-rutas'], queryFn: getRutasSiesa })

  const [modal, setModal] = useState<'nueva' | 'editar' | null>(null)
  const [selected, setSelected] = useState<Maquina | null>(null)
  const [form, setForm] = useState<MaquinaForm>(EMPTY_MAQUINA_FORM)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['config-maquinas'] })

  const mutCreate = useMutation({
    mutationFn: createMaquina,
    onSuccess: () => { invalidate(); setModal(null); setForm(EMPTY_MAQUINA_FORM) },
  })

  const mutUpdate = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) => updateMaquina(id, data),
    onSuccess: () => { invalidate(); setModal(null) },
  })

  const openNueva = () => { setForm(EMPTY_MAQUINA_FORM); setModal('nueva') }

  const openEditar = (m: Maquina) => {
    setSelected(m)
    setForm({
      nombre: m.nombre,
      capacidad_hora: String(m.capacidad_hora),
      centro_costos_id: String(m.centro_costos_id),
      estado_id: String(m.estado_id),
      rutas_siesa_id: m.rutas_siesa_id ? String(m.rutas_siesa_id) : '',
      calcula_capacidad: m.calcula_capacidad ?? true,
    })
    setModal('editar')
  }

  const isFormValid = form.nombre && form.capacidad_hora && form.centro_costos_id && form.estado_id

  const handleCreate = () => {
    mutCreate.mutate({
      nombre: form.nombre,
      capacidad_hora: Number(form.capacidad_hora),
      centro_costos_id: Number(form.centro_costos_id),
      estado_id: Number(form.estado_id),
      rutas_siesa_id: form.rutas_siesa_id ? Number(form.rutas_siesa_id) : null,
      calcula_capacidad: form.calcula_capacidad,
    })
  }

  const handleUpdate = () => {
    if (!selected) return
    mutUpdate.mutate({
      id: selected.id,
      data: {
        nombre: form.nombre || undefined,
        capacidad_hora: form.capacidad_hora ? Number(form.capacidad_hora) : undefined,
        centro_costos_id: form.centro_costos_id ? Number(form.centro_costos_id) : undefined,
        estado_id: form.estado_id ? Number(form.estado_id) : undefined,
        rutas_siesa_id: form.rutas_siesa_id ? Number(form.rutas_siesa_id) : null,
        calcula_capacidad: form.calcula_capacidad,
      },
    })
  }

  const ESTADO_COLOR: Record<string, string> = {
    'Disponible': 'bg-emerald-100 text-emerald-700',
    'En Mantenimiento': 'bg-rose-100 text-rose-600',
  }

  return (
    <div className="space-y-6">
      {/* ── Section card ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Cpu size={18} className="text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Máquinas</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {maquinas.length} máquina(s) registrada(s) en el sistema
              </p>
            </div>
          </div>
          {permiso.crear && (
            <button
              onClick={openNueva}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl px-5 py-2.5 text-sm shadow-sm transition-all"
            >
              <PlusCircle size={16} /> Nueva Máquina
            </button>
          )}
        </div>

        {isLoading && <Loading label="Cargando máquinas..." />}

        {!isLoading && maquinas.length === 0 && (
          <div className="py-12 text-center">
            <Cpu size={40} className="mx-auto text-slate-200 mb-3" />
            <p className="text-slate-400 font-medium italic">Sin máquinas registradas.</p>
          </div>
        )}

        {!isLoading && maquinas.length > 0 && (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Máquina</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Capacidad</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Centro de Costos</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Ruta SIESA</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Calcula Cap.</th>
                  {permiso.editar && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {maquinas.map((m, idx) => (
                  <tr
                    key={m.id}
                    className={`border-b border-slate-100 transition-colors hover:bg-blue-50/40 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Cpu size={13} className="text-blue-600" />
                        </div>
                        <span className="font-medium text-slate-700">{m.nombre}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {m.capacidad_hora.toLocaleString()} u/h
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {m.centro_costos ?? <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ESTADO_COLOR[m.estado_descripcion ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>
                        {m.estado_descripcion ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {m.rutas_siesa_nombre ?? <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${m.calcula_capacidad ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {m.calcula_capacidad ? 'Sí' : 'No'}
                      </span>
                    </td>
                    {permiso.editar && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEditar(m)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Editar"
                        >
                          <Pencil size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal === 'nueva' && (
        <Modal title="Nueva Máquina" onClose={() => setModal(null)}>
          <MaquinaFormFields form={form} onChange={setForm} centros={centros} estados={estados} rutas={rutas} />
          <button
            onClick={handleCreate}
            disabled={!isFormValid || mutCreate.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-xl px-5 py-2.5 shadow-sm transition-all"
          >
            {mutCreate.isPending ? 'Guardando...' : 'Crear Máquina'}
          </button>
          {mutCreate.isError && (
            <p className="text-rose-500 text-xs text-center">
              {(mutCreate.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al crear la máquina'}
            </p>
          )}
        </Modal>
      )}

      {modal === 'editar' && selected && (
        <Modal title={`Editar — ${selected.nombre}`} onClose={() => setModal(null)}>
          <MaquinaFormFields form={form} onChange={setForm} centros={centros} estados={estados} rutas={rutas} />
          <button
            onClick={handleUpdate}
            disabled={mutUpdate.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-xl px-5 py-2.5 shadow-sm transition-all"
          >
            {mutUpdate.isPending ? 'Guardando...' : 'Guardar Cambios'}
          </button>
          {mutUpdate.isError && (
            <p className="text-rose-500 text-xs text-center">
              {(mutUpdate.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al guardar los cambios'}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}

// ─── Form de ruta SIESA ───────────────────────────────────────────────────────
type RutaForm = { nombre_ruta: string; descripcion: string; orden: string; activo: boolean }
const EMPTY_RUTA_FORM: RutaForm = { nombre_ruta: '', descripcion: '', orden: '0', activo: true }

// ─── Tab: Rutas SIESA ─────────────────────────────────────────────────────────
function TabRutasSiesa() {
  const qc = useQueryClient()
  const permiso = usePermiso('configuracion')

  const { data: rutas = [], isLoading } = useQuery<RutaSiesa[]>({ queryKey: ['config-rutas'], queryFn: getRutasSiesa })

  const [modal, setModal] = useState<'nueva' | 'editar' | null>(null)
  const [selected, setSelected] = useState<RutaSiesa | null>(null)
  const [form, setForm] = useState<RutaForm>(EMPTY_RUTA_FORM)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['config-rutas'] })

  const mutCreate = useMutation({
    mutationFn: createRutaSiesa,
    onSuccess: () => { invalidate(); setModal(null); setForm(EMPTY_RUTA_FORM) },
  })

  const mutUpdate = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) => updateRutaSiesa(id, data),
    onSuccess: () => { invalidate(); setModal(null) },
  })

  const openNueva = () => { setForm(EMPTY_RUTA_FORM); setModal('nueva') }

  const openEditar = (r: RutaSiesa) => {
    setSelected(r)
    setForm({ nombre_ruta: r.nombre_ruta, descripcion: r.descripcion ?? '', orden: String(r.orden ?? 0), activo: r.activo })
    setModal('editar')
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
              <Route size={18} className="text-violet-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Rutas SIESA</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {rutas.length} ruta(s) registrada(s) en el sistema
              </p>
            </div>
          </div>
          {permiso.crear && (
            <button
              onClick={openNueva}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl px-5 py-2.5 text-sm shadow-sm transition-all"
            >
              <PlusCircle size={16} /> Nueva Ruta
            </button>
          )}
        </div>

        {isLoading && <Loading label="Cargando rutas..." />}

        {!isLoading && rutas.length === 0 && (
          <div className="py-12 text-center">
            <Route size={40} className="mx-auto text-slate-200 mb-3" />
            <p className="text-slate-400 font-medium italic">Sin rutas registradas.</p>
          </div>
        )}

        {!isLoading && rutas.length > 0 && (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Orden</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre de Ruta</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Descripción</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
                  {permiso.editar && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {rutas.map((r, idx) => (
                  <tr
                    key={r.id}
                    className={`border-b border-slate-100 transition-colors hover:bg-blue-50/40 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold tabular-nums">
                        {r.orden ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                          <Route size={13} className="text-violet-600" />
                        </div>
                        <span className="font-medium text-slate-700">{r.nombre_ruta}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {r.descripcion ?? <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${r.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {r.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {permiso.editar && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEditar(r)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Editar"
                        >
                          <Pencil size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal === 'nueva' && (
        <Modal title="Nueva Ruta SIESA" onClose={() => setModal(null)}>
          <Field label="Nombre de ruta *">
            <input
              className={INPUT}
              value={form.nombre_ruta}
              onChange={e => setForm(f => ({ ...f, nombre_ruta: e.target.value }))}
              placeholder="Ej. PEGADORA DE ANILLOS"
            />
          </Field>
          <Field label="Descripción">
            <input
              className={INPUT}
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Opcional"
            />
          </Field>
          <Field label="Orden">
            <input
              type="number"
              className={INPUT}
              value={form.orden}
              onChange={e => setForm(f => ({ ...f, orden: e.target.value }))}
              placeholder="0"
            />
          </Field>
          <button
            onClick={() => mutCreate.mutate({
              nombre_ruta: form.nombre_ruta,
              descripcion: form.descripcion || null,
              orden: Number(form.orden) || 0,
            })}
            disabled={!form.nombre_ruta || mutCreate.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-xl px-5 py-2.5 shadow-sm transition-all"
          >
            {mutCreate.isPending ? 'Guardando...' : 'Crear Ruta'}
          </button>
          {mutCreate.isError && (
            <p className="text-rose-500 text-xs text-center">
              {(mutCreate.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al crear la ruta'}
            </p>
          )}
        </Modal>
      )}

      {modal === 'editar' && selected && (
        <Modal title={`Editar — ${selected.nombre_ruta}`} onClose={() => setModal(null)}>
          <Field label="Nombre de ruta *">
            <input
              className={INPUT}
              value={form.nombre_ruta}
              onChange={e => setForm(f => ({ ...f, nombre_ruta: e.target.value }))}
            />
          </Field>
          <Field label="Descripción">
            <input
              className={INPUT}
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Opcional"
            />
          </Field>
          <Field label="Orden">
            <input
              type="number"
              className={INPUT}
              value={form.orden}
              onChange={e => setForm(f => ({ ...f, orden: e.target.value }))}
              placeholder="0"
            />
          </Field>
          <Field label="Estado">
            <select
              className={SELECT}
              value={form.activo ? '1' : '0'}
              onChange={e => setForm(f => ({ ...f, activo: e.target.value === '1' }))}
            >
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </select>
          </Field>
          <button
            onClick={() => mutUpdate.mutate({
              id: selected.id,
              data: {
                nombre_ruta: form.nombre_ruta || undefined,
                descripcion: form.descripcion || null,
                orden: Number(form.orden) || 0,
                activo: form.activo,
              },
            })}
            disabled={!form.nombre_ruta || mutUpdate.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-xl px-5 py-2.5 shadow-sm transition-all"
          >
            {mutUpdate.isPending ? 'Guardando...' : 'Guardar Cambios'}
          </button>
          {mutUpdate.isError && (
            <p className="text-rose-500 text-xs text-center">
              {(mutUpdate.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al guardar los cambios'}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}

// ─── Tab: Metas KPI ───────────────────────────────────────────────────────────
type MetaKPI = { id: number; kpi: string; label: string; valor: number }

const KPI_ICON: Record<string, { color: string; bg: string }> = {
  tasa_servicio:  { color: 'text-violet-600', bg: 'bg-violet-100' },
  disponibilidad: { color: 'text-teal-600',   bg: 'bg-teal-100' },
  eficiencia:     { color: 'text-orange-600', bg: 'bg-orange-100' },
  calidad:        { color: 'text-cyan-600',   bg: 'bg-cyan-100' },
}

function TabMetas() {
  const qc = useQueryClient()
  const permiso = usePermiso('configuracion')

  const { data: metas = [], isLoading } = useQuery<MetaKPI[]>({
    queryKey: ['config-metas'],
    queryFn: getMetas,
  })

  const [editing, setEditing] = useState<Record<string, string>>({})

  const mutUpdate = useMutation({
    mutationFn: ({ kpi, valor }: { kpi: string; valor: number }) => updateMeta(kpi, valor),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config-metas'] }),
  })

  const startEdit = (m: MetaKPI) =>
    setEditing(prev => ({ ...prev, [m.kpi]: String(m.valor) }))

  const saveEdit = (m: MetaKPI) => {
    const raw = editing[m.kpi]
    const parsed = parseFloat(raw)
    if (isNaN(parsed) || parsed < 0 || parsed > 100) return
    mutUpdate.mutate({ kpi: m.kpi, valor: parsed })
    setEditing(prev => { const n = { ...prev }; delete n[m.kpi]; return n })
  }

  const cancelEdit = (kpi: string) =>
    setEditing(prev => { const n = { ...prev }; delete n[kpi]; return n })

  if (isLoading) return <Loading label="Cargando metas..." />

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Target size={18} className="text-indigo-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Metas de KPIs</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Objetivos mostrados como referencia en el dashboard de producción
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {metas.map(m => {
            const style = KPI_ICON[m.kpi] ?? { color: 'text-slate-600', bg: 'bg-slate-100' }
            const isEditingThis = m.kpi in editing

            return (
              <div
                key={m.kpi}
                className="flex items-center justify-between gap-4 p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-white transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${style.bg}`}>
                    <Target size={16} className={style.color} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700">{m.label}</p>
                    <p className="text-xs text-slate-400 font-mono">{m.kpi}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {isEditingThis ? (
                    <>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          className="w-24 px-3 py-1.5 pr-7 bg-white border border-blue-300 rounded-lg text-sm text-slate-700 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={editing[m.kpi]}
                          onChange={e => setEditing(prev => ({ ...prev, [m.kpi]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(m); if (e.key === 'Escape') cancelEdit(m.kpi) }}
                          autoFocus
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">%</span>
                      </div>
                      <button
                        onClick={() => saveEdit(m)}
                        disabled={mutUpdate.isPending}
                        className="p-1.5 bg-emerald-100 text-emerald-600 hover:bg-emerald-200 rounded-lg transition"
                        title="Guardar"
                      >
                        <Check size={15} />
                      </button>
                      <button
                        onClick={() => cancelEdit(m.kpi)}
                        className="p-1.5 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-lg transition"
                        title="Cancelar"
                      >
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={`text-lg font-bold tabular-nums ${style.color}`}>
                        {m.valor.toFixed(1)}%
                      </span>
                      {permiso.editar && (
                        <button
                          onClick={() => startEdit(m)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Editar meta"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-slate-400 mt-5 pt-4 border-t border-slate-100">
          Solo administradores pueden modificar las metas. Los valores se reflejan inmediatamente en el dashboard.
        </p>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Configuracion() {
  const [tab, setTab] = useState<'maquinas' | 'rutas' | 'metas'>('maquinas')

  const pillBtn = (active: boolean) =>
    `flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-all ${
      active
        ? 'bg-white shadow-sm text-blue-600 font-medium'
        : 'text-slate-500 hover:text-slate-700 font-medium'
    }`

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top gradient hero ── */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Settings size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Sistema</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Configuración</h1>
              <p className="text-blue-200 text-sm mt-1">Administra máquinas y rutas SIESA del sistema</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="px-6 -mt-5 pb-10 max-w-6xl mx-auto space-y-6">
        {/* ── Pill tabs ── */}
        <div className="bg-slate-100 rounded-xl p-1 inline-flex gap-1">
          <button className={pillBtn(tab === 'maquinas')} onClick={() => setTab('maquinas')}>
            <Cpu size={14} /> Máquinas
          </button>
          <button className={pillBtn(tab === 'rutas')} onClick={() => setTab('rutas')}>
            <Route size={14} /> Rutas SIESA
          </button>
          <button className={pillBtn(tab === 'metas')} onClick={() => setTab('metas')}>
            <Target size={14} /> Metas KPI
          </button>
        </div>

        {tab === 'maquinas' && <TabMaquinas />}
        {tab === 'rutas' && <TabRutasSiesa />}
        {tab === 'metas' && <TabMetas />}
      </div>
    </div>
  )
}
