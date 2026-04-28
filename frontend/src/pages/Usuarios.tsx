import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUsuarios, createUsuario, updateUsuario, deleteUsuario, resetPassword } from '../api/users'
import { getRoles, createRol, deleteRol, updatePermisos } from '../api/roles'
import {
  UserPlus, Pencil, KeyRound, UserX, X, Shield, ShieldPlus, Trash2,
  Users, Search, UsersRound, UserCheck, ShieldCheck, UserCog,
} from 'lucide-react'
import Loading from '../components/Loading'

// ─── Types ──────────────────────────────────────────────────────────────────
type Permiso = { puede_ver: boolean; puede_crear: boolean; puede_editar: boolean; puede_eliminar: boolean }
type RolPermiso = { modulo: string } & Permiso
type Rol = { id: number; nombre: string; descripcion?: string; activo: boolean; permisos: RolPermiso[] }
type Usuario = { id: number; username: string; nombre: string; rol: string; activo: boolean; rol_id?: number; rol_nombre?: string }

// ─── Constants ───────────────────────────────────────────────────────────────
const MODULOS: { clave: string; label: string }[] = [
  { clave: 'dashboard',      label: 'Dashboard' },
  { clave: 'ordenes',        label: 'Órdenes' },
  { clave: 'gantt',          label: 'Gantt' },
  { clave: 'planeacion',     label: 'Planeación' },
  { clave: 'mantenimiento',  label: 'Mantenimiento' },
  { clave: 'reportes',       label: 'Reportes' },
  { clave: 'usuarios',       label: 'Usuarios' },
  { clave: 'configuracion',  label: 'Configuración' },
  { clave: 'cerrar_op',      label: 'Cerrar OP' },
]

const ACCIONES: { key: keyof Permiso; label: string }[] = [
  { key: 'puede_ver',      label: 'Ver' },
  { key: 'puede_crear',    label: 'Crear' },
  { key: 'puede_editar',   label: 'Editar' },
  { key: 'puede_eliminar', label: 'Eliminar' },
]

const INPUT  = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm'
const SELECT = `${INPUT} bg-white`

// ─── Role pill color ────────────────────────────────────────────────────────
function rolePillClass(name: string): string {
  const n = (name || '').toLowerCase()
  if (n.includes('admin'))      return 'bg-violet-100 text-violet-700'
  if (n.includes('supervisor')) return 'bg-amber-100 text-amber-700'
  if (n.includes('operador'))   return 'bg-blue-100 text-blue-700'
  if (n.includes('plane'))      return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-600'
}

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/)
  if (!parts.length || !parts[0]) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
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

// ─── Field helper ────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col border border-slate-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

// ─── Matriz de permisos ──────────────────────────────────────────────────────
function MatrizPermisos({
  value,
  onChange,
}: {
  value: RolPermiso[]
  onChange: (v: RolPermiso[]) => void
}) {
  const getP = (modulo: string): RolPermiso =>
    value.find(p => p.modulo === modulo) ?? { modulo, puede_ver: false, puede_crear: false, puede_editar: false, puede_eliminar: false }

  const toggle = (modulo: string, accion: keyof Permiso) => {
    const current = getP(modulo)
    const updated = { ...current, [accion]: !current[accion] }
    // Si se desactiva 'puede_ver', desactivar todo
    if (accion === 'puede_ver' && !updated.puede_ver) {
      updated.puede_crear = false; updated.puede_editar = false; updated.puede_eliminar = false
    }
    // Si se activa cualquier acción, activar 'puede_ver'
    if (accion !== 'puede_ver' && updated[accion]) updated.puede_ver = true
    onChange(value.filter(p => p.modulo !== modulo).concat(updated))
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">Módulo</th>
            {ACCIONES.map(a => (
              <th key={a.key} className="px-3 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide text-center">{a.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULOS.map(({ clave, label }, i) => {
            const p = getP(clave)
            return (
              <tr key={clave} className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-blue-50/40 transition-colors`}>
                <td className="px-3 py-2 font-medium text-slate-700">{label}</td>
                {ACCIONES.map(a => (
                  <td key={a.key} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={p[a.key]}
                      onChange={() => toggle(clave, a.key)}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Tab: Roles ──────────────────────────────────────────────────────────────
function TabRoles() {
  const qc = useQueryClient()
  const { data: roles = [] } = useQuery<Rol[]>({ queryKey: ['roles'], queryFn: getRoles })

  const [showNuevo, setShowNuevo] = useState(false)
  const [editando, setEditando] = useState<Rol | null>(null)

  const [nuevoForm, setNuevoForm] = useState({ nombre: '', descripcion: '', permisos: [] as RolPermiso[] })

  const mutCreate = useMutation({
    mutationFn: createRol,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setShowNuevo(false); setNuevoForm({ nombre: '', descripcion: '', permisos: [] }) },
  })

  const mutUpdatePermisos = useMutation({
    mutationFn: ({ id, permisos }: { id: number; permisos: RolPermiso[] }) => updatePermisos(id, permisos),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setEditando(null) },
  })

  const mutDelete = useMutation({
    mutationFn: deleteRol,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })

  const [editPermisos, setEditPermisos] = useState<RolPermiso[]>([])

  const openEdit = (r: Rol) => {
    setEditPermisos(r.permisos.map(p => ({ ...p })))
    setEditando(r)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-700">{roles.length}</span> roles configurados
        </p>
        <button
          onClick={() => setShowNuevo(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <ShieldPlus size={16} /> Nuevo Rol
        </button>
      </div>

      {roles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <Shield size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-slate-400 font-medium">No hay roles configurados.</p>
          <p className="text-slate-300 text-sm mt-1">Crea uno nuevo para empezar.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map(r => {
            const modulosActivos = r.permisos.filter(p => p.puede_ver).length
            return (
              <div
                key={r.id}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-center justify-between gap-4 hover:shadow-md hover:border-blue-100 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-sm">
                    <Shield size={20} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{r.nombre}</p>
                    {r.descripcion && <p className="text-xs text-slate-500 truncate">{r.descripcion}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">
                      <span className="font-semibold text-slate-600">{modulosActivos}</span> módulo(s) con acceso
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(r)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
                  >
                    <Pencil size={13} /> Permisos
                  </button>
                  <button
                    onClick={() => { if (confirm(`¿Desactivar el rol "${r.nombre}"?`)) mutDelete.mutate(r.id) }}
                    className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title="Desactivar"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal nuevo rol */}
      {showNuevo && (
        <Modal title="Nuevo Rol" onClose={() => setShowNuevo(false)}>
          <div className="space-y-4">
            <Field label="Nombre *">
              <input className={INPUT} value={nuevoForm.nombre} onChange={e => setNuevoForm(f => ({ ...f, nombre: e.target.value }))} />
            </Field>
            <Field label="Descripción">
              <input className={INPUT} value={nuevoForm.descripcion} onChange={e => setNuevoForm(f => ({ ...f, descripcion: e.target.value }))} />
            </Field>
            <Field label="Permisos por módulo">
              <MatrizPermisos value={nuevoForm.permisos} onChange={p => setNuevoForm(f => ({ ...f, permisos: p }))} />
            </Field>
            <button
              onClick={() => mutCreate.mutate({ nombre: nuevoForm.nombre, descripcion: nuevoForm.descripcion || undefined, permisos: nuevoForm.permisos })}
              disabled={!nuevoForm.nombre || mutCreate.isPending}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {mutCreate.isPending ? 'Guardando...' : 'Crear Rol'}
            </button>
            {mutCreate.isError && (
              <p className="text-rose-500 text-xs text-center">
                {(mutCreate.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al crear el rol'}
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Modal editar permisos */}
      {editando && (
        <Modal title={`Permisos — ${editando.nombre}`} onClose={() => setEditando(null)}>
          <div className="space-y-4">
            <MatrizPermisos value={editPermisos} onChange={setEditPermisos} />
            <button
              onClick={() => mutUpdatePermisos.mutate({ id: editando.id, permisos: editPermisos })}
              disabled={mutUpdatePermisos.isPending}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {mutUpdatePermisos.isPending ? 'Guardando...' : 'Guardar Permisos'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Tab: Usuarios ───────────────────────────────────────────────────────────
function TabUsuarios({ onOpenNuevo }: { onOpenNuevo?: (open: () => void) => void }) {
  const qc = useQueryClient()
  const { data: usuarios = [], isLoading } = useQuery<Usuario[]>({ queryKey: ['usuarios'], queryFn: getUsuarios })
  const { data: roles = [] } = useQuery<Rol[]>({ queryKey: ['roles'], queryFn: getRoles })

  const [modal, setModal] = useState<'nuevo' | 'editar' | 'password' | null>(null)
  const [selected, setSelected] = useState<Usuario | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const [nuevoForm, setNuevoForm] = useState({ username: '', nombre: '', password: '', rol_id: '' })
  const [editForm, setEditForm] = useState({ nombre: '', rol_id: '', activo: true })
  const [pwdForm, setPwdForm] = useState({ nueva_password: '' })

  const mutCreate = useMutation({
    mutationFn: createUsuario,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setModal(null); setNuevoForm({ username: '', nombre: '', password: '', rol_id: '' }) },
  })
  const mutUpdate = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) => updateUsuario(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setModal(null) },
  })
  const mutDelete = useMutation({
    mutationFn: deleteUsuario,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usuarios'] }),
  })
  const mutPwd = useMutation({
    mutationFn: ({ id, pwd }: { id: number; pwd: string }) => resetPassword(id, pwd),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); setModal(null) },
  })

  const openEdit = (u: Usuario) => {
    setSelected(u)
    setEditForm({ nombre: u.nombre, rol_id: String(u.rol_id ?? ''), activo: u.activo })
    setModal('editar')
  }

  // Expose opener to parent (hero button)
  if (onOpenNuevo) onOpenNuevo(() => setModal('nuevo'))

  // ─── Filter + KPIs ────────────────────────────────────────────────────────
  const filteredUsuarios = useMemo(() => {
    const q = busqueda.toLowerCase().trim()
    if (!q) return usuarios
    return usuarios.filter(u =>
      u.nombre.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.rol_nombre ?? u.rol ?? '').toLowerCase().includes(q)
    )
  }, [usuarios, busqueda])

  const kpis = useMemo(() => {
    const total = usuarios.length
    const activos = usuarios.filter(u => u.activo).length
    const admins = usuarios.filter(u => (u.rol_nombre ?? u.rol ?? '').toLowerCase().includes('admin')).length
    const supervisores = usuarios.filter(u => (u.rol_nombre ?? u.rol ?? '').toLowerCase().includes('supervisor')).length
    return { total, activos, admins, supervisores }
  }, [usuarios])

  return (
    <div className="space-y-6">
      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<UsersRound size={22} className="text-blue-600" />}
          label="Total usuarios"
          value={String(kpis.total)}
          sub="registrados en el sistema"
          accent="bg-blue-100"
        />
        <KpiCard
          icon={<UserCheck size={22} className="text-emerald-600" />}
          label="Activos"
          value={String(kpis.activos)}
          sub={`${kpis.total - kpis.activos} inactivo(s)`}
          accent="bg-emerald-100"
        />
        <KpiCard
          icon={<ShieldCheck size={22} className="text-violet-600" />}
          label="Administradores"
          value={String(kpis.admins)}
          sub="con acceso total"
          accent="bg-violet-100"
        />
        <KpiCard
          icon={<UserCog size={22} className="text-amber-600" />}
          label="Supervisores"
          value={String(kpis.supervisores)}
          sub="con rol operativo"
          accent="bg-amber-100"
        />
      </div>

      {/* ── Search bar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, usuario o rol..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          />
        </div>
        {busqueda && (
          <button
            onClick={() => setBusqueda('')}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            Limpiar
          </button>
        )}
        <p className="text-sm text-slate-500 ml-auto">
          <span className="font-semibold text-slate-700">{filteredUsuarios.length}</span>
          {' '}de{' '}
          <span className="font-semibold text-slate-700">{usuarios.length}</span>
          {' '}usuarios
        </p>
      </div>

      {isLoading && <Loading label="Cargando usuarios..." />}

      {/* ── Users table ── */}
      {!isLoading && (
        filteredUsuarios.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
            <Users size={40} className="mx-auto text-slate-200 mb-3" />
            <p className="text-slate-400 font-medium">
              {busqueda ? 'Sin resultados para la búsqueda.' : 'No hay usuarios registrados.'}
            </p>
            <p className="text-slate-300 text-sm mt-1">
              {busqueda ? 'Prueba con otro término.' : 'Crea un usuario nuevo para empezar.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-5 py-3.5 font-semibold text-slate-600 text-xs uppercase tracking-wide">Usuario</th>
                    <th className="text-left px-4 py-3.5 font-semibold text-slate-600 text-xs uppercase tracking-wide">Rol</th>
                    <th className="text-left px-4 py-3.5 font-semibold text-slate-600 text-xs uppercase tracking-wide">Estado</th>
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody>
                  {filteredUsuarios.map((u, idx) => {
                    const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                    const rolName = u.rol_nombre ?? u.rol
                    return (
                      <tr
                        key={u.id}
                        className={`border-b border-slate-100 last:border-0 ${rowBg} hover:bg-blue-50/40 transition-colors`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-sm shrink-0">
                              {initialsOf(u.nombre)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 truncate">{u.nombre}</p>
                              <p className="text-xs text-slate-400 truncate">@{u.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${rolePillClass(rolName)}`}>
                            {rolName}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${u.activo ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            <span className={`text-xs font-semibold ${u.activo ? 'text-emerald-700' : 'text-slate-400'}`}>
                              {u.activo ? 'Activo' : 'Inactivo'}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => openEdit(u)}
                              className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors"
                              title="Editar"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              onClick={() => { setSelected(u); setPwdForm({ nueva_password: '' }); setModal('password') }}
                              className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-slate-100 transition-colors"
                              title="Cambiar contraseña"
                            >
                              <KeyRound size={15} />
                            </button>
                            <button
                              onClick={() => { if (confirm(`¿Desactivar a "${u.nombre}"?`)) mutDelete.mutate(u.id) }}
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition-colors"
                              title="Desactivar"
                            >
                              <UserX size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Modal nuevo usuario */}
      {modal === 'nuevo' && (
        <Modal title="Nuevo Usuario" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Username *">
              <input className={INPUT} value={nuevoForm.username} onChange={e => setNuevoForm(f => ({ ...f, username: e.target.value }))} />
            </Field>
            <Field label="Nombre completo *">
              <input className={INPUT} value={nuevoForm.nombre} onChange={e => setNuevoForm(f => ({ ...f, nombre: e.target.value }))} />
            </Field>
            <Field label="Contraseña *">
              <input type="password" className={INPUT} value={nuevoForm.password} onChange={e => setNuevoForm(f => ({ ...f, password: e.target.value }))} />
            </Field>
            <Field label="Rol *">
              <select className={SELECT} value={nuevoForm.rol_id} onChange={e => setNuevoForm(f => ({ ...f, rol_id: e.target.value }))}>
                <option value="">Seleccionar rol...</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </Field>
            <button
              onClick={() => mutCreate.mutate({ username: nuevoForm.username, nombre: nuevoForm.nombre, password: nuevoForm.password, rol_id: Number(nuevoForm.rol_id) })}
              disabled={!nuevoForm.username || !nuevoForm.nombre || !nuevoForm.password || !nuevoForm.rol_id || mutCreate.isPending}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {mutCreate.isPending ? 'Guardando...' : 'Crear Usuario'}
            </button>
            {mutCreate.isError && <p className="text-rose-500 text-xs text-center">Error al crear usuario</p>}
          </div>
        </Modal>
      )}

      {/* Modal editar usuario */}
      {modal === 'editar' && selected && (
        <Modal title={`Editar — ${selected.username}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nombre">
              <input className={INPUT} value={editForm.nombre} onChange={e => setEditForm(f => ({ ...f, nombre: e.target.value }))} />
            </Field>
            <Field label="Rol">
              <select className={SELECT} value={editForm.rol_id} onChange={e => setEditForm(f => ({ ...f, rol_id: e.target.value }))}>
                <option value="">Sin cambiar</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </Field>
            <Field label="Estado">
              <select className={SELECT} value={editForm.activo ? '1' : '0'} onChange={e => setEditForm(f => ({ ...f, activo: e.target.value === '1' }))}>
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
              </select>
            </Field>
            <button
              onClick={() => mutUpdate.mutate({ id: selected.id, data: { nombre: editForm.nombre || undefined, rol_id: editForm.rol_id ? Number(editForm.rol_id) : undefined, activo: editForm.activo } })}
              disabled={mutUpdate.isPending}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {mutUpdate.isPending ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal cambiar contraseña */}
      {modal === 'password' && selected && (
        <Modal title={`Contraseña — ${selected.username}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nueva contraseña *">
              <input type="password" className={INPUT} value={pwdForm.nueva_password} onChange={e => setPwdForm({ nueva_password: e.target.value })} />
            </Field>
            <button
              onClick={() => mutPwd.mutate({ id: selected.id, pwd: pwdForm.nueva_password })}
              disabled={!pwdForm.nueva_password || mutPwd.isPending}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {mutPwd.isPending ? 'Cambiando...' : 'Cambiar Contraseña'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Página principal ────────────────────────────────────────────────────────
export default function Usuarios() {
  const [tab, setTab] = useState<'usuarios' | 'roles'>('usuarios')

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top gradient hero ── */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Users size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Administración</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Usuarios y Roles</h1>
              <p className="text-blue-200 text-sm mt-1">Gestiona accesos, roles y permisos del sistema</p>
            </div>
          </div>

          {/* Tabs — glass style */}
          <div className="inline-flex items-center gap-1 p-1 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20">
            {(['usuarios', 'roles'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                  tab === t
                    ? 'bg-white text-blue-800 shadow-sm'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                {t === 'usuarios' ? 'Usuarios' : 'Roles y Permisos'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">
        {tab === 'usuarios' ? <TabUsuariosWithHeroButton /> : <TabRoles />}
      </div>
    </div>
  )
}

// Wrapper that renders a floating "Nuevo Usuario" button docked into the hero look
function TabUsuariosWithHeroButton() {
  const [openFn, setOpenFn] = useState<(() => void) | null>(null)

  return (
    <>
      {/* Action bar floats just above the KPI cards to mimic hero-right-button pattern */}
      <div className="flex justify-end -mt-2">
        <button
          onClick={() => openFn && openFn()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl shadow-sm transition-colors"
        >
          <UserPlus size={15} />
          Nuevo Usuario
        </button>
      </div>
      <TabUsuarios onOpenNuevo={(fn) => { if (!openFn) setOpenFn(() => fn) }} />
    </>
  )
}
