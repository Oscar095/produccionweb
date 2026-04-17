import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUsuarios, createUsuario, updateUsuario, deleteUsuario, resetPassword } from '../api/users'
import { getRoles, createRol, deleteRol, updatePermisos } from '../api/roles'
import { UserPlus, Pencil, KeyRound, UserX, X, Shield, ShieldPlus, Trash2 } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────
type Permiso = { puede_ver: boolean; puede_crear: boolean; puede_editar: boolean; puede_eliminar: boolean }
type RolPermiso = { modulo: string } & Permiso
type Rol = { id: number; nombre: string; descripcion?: string; activo: boolean; permisos: RolPermiso[] }
type Usuario = { id: number; username: string; nombre: string; rol: string; activo: boolean; rol_id?: number; rol_nombre?: string }

// ─── Constants ───────────────────────────────────────────────────────────────
const MODULOS: { clave: string; label: string }[] = [
  { clave: 'dashboard',     label: 'Dashboard' },
  { clave: 'ordenes',       label: 'Órdenes' },
  { clave: 'gantt',         label: 'Gantt' },
  { clave: 'planeacion',    label: 'Planeación' },
  { clave: 'mantenimiento', label: 'Mantenimiento' },
  { clave: 'reportes',      label: 'Reportes' },
  { clave: 'usuarios',      label: 'Usuarios' },
]

const ACCIONES: { key: keyof Permiso; label: string }[] = [
  { key: 'puede_ver',      label: 'Ver' },
  { key: 'puede_crear',    label: 'Crear' },
  { key: 'puede_editar',   label: 'Editar' },
  { key: 'puede_eliminar', label: 'Eliminar' },
]

const INPUT  = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'
const SELECT = `${INPUT} bg-white`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
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
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Módulo</th>
            {ACCIONES.map(a => (
              <th key={a.key} className="px-3 py-2 text-xs font-medium text-gray-500 text-center">{a.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULOS.map(({ clave, label }, i) => {
            const p = getP(clave)
            return (
              <tr key={clave} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-3 py-2 font-medium text-gray-700">{label}</td>
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{roles.length} roles configurados</p>
        <button onClick={() => setShowNuevo(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">
          <ShieldPlus size={16} /> Nuevo Rol
        </button>
      </div>

      <div className="space-y-3">
        {roles.map(r => {
          const modulosActivos = r.permisos.filter(p => p.puede_ver).length
          return (
            <div key={r.id} className="bg-white rounded-xl border shadow-sm p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Shield size={20} className="text-blue-500 shrink-0" />
                <div>
                  <p className="font-semibold text-gray-800">{r.nombre}</p>
                  {r.descripcion && <p className="text-xs text-gray-500">{r.descripcion}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">{modulosActivos} módulo(s) con acceso</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openEdit(r)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 text-gray-600">
                  <Pencil size={13} /> Permisos
                </button>
                <button onClick={() => { if (confirm(`¿Desactivar el rol "${r.nombre}"?`)) mutDelete.mutate(r.id) }}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

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
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {mutCreate.isPending ? 'Guardando...' : 'Crear Rol'}
            </button>
            {mutCreate.isError && (
              <p className="text-red-500 text-xs text-center">
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
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {mutUpdatePermisos.isPending ? 'Guardando...' : 'Guardar Permisos'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Tab: Usuarios ───────────────────────────────────────────────────────────
function TabUsuarios() {
  const qc = useQueryClient()
  const { data: usuarios = [], isLoading } = useQuery<Usuario[]>({ queryKey: ['usuarios'], queryFn: getUsuarios })
  const { data: roles = [] } = useQuery<Rol[]>({ queryKey: ['roles'], queryFn: getRoles })

  const [modal, setModal] = useState<'nuevo' | 'editar' | 'password' | null>(null)
  const [selected, setSelected] = useState<Usuario | null>(null)

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

  const ROL_COLOR: Record<string, string> = {}
  const COLORS = ['bg-purple-100 text-purple-700', 'bg-blue-100 text-blue-700', 'bg-green-100 text-green-700', 'bg-orange-100 text-orange-700', 'bg-gray-100 text-gray-600']
  roles.forEach((r, i) => { ROL_COLOR[r.nombre] = COLORS[i % COLORS.length] })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{usuarios.length} usuarios registrados</p>
        <button onClick={() => setModal('nuevo')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">
          <UserPlus size={16} /> Nuevo Usuario
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Cargando...</p>}

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Usuario</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Rol</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {usuarios.map(u => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-800">{u.nombre}</p>
                  <p className="text-xs text-gray-400">@{u.username}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROL_COLOR[u.rol_nombre ?? u.rol] ?? 'bg-gray-100 text-gray-600'}`}>
                    {u.rol_nombre ?? u.rol}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${u.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-500'}`}>
                    {u.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(u)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Editar">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => { setSelected(u); setPwdForm({ nueva_password: '' }); setModal('password') }}
                      className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition" title="Cambiar contraseña">
                      <KeyRound size={15} />
                    </button>
                    <button onClick={() => { if (confirm(`¿Desactivar a "${u.nombre}"?`)) mutDelete.mutate(u.id) }}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Desactivar">
                      <UserX size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {mutCreate.isPending ? 'Guardando...' : 'Crear Usuario'}
            </button>
            {mutCreate.isError && <p className="text-red-500 text-xs text-center">Error al crear usuario</p>}
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
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
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
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
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
    <div className="p-6 space-y-5">
      <h2 className="text-2xl font-bold text-gray-800">Gestión de Accesos</h2>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(['usuarios', 'roles'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition capitalize
              ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'usuarios' ? 'Usuarios' : 'Roles y Permisos'}
          </button>
        ))}
      </div>

      {tab === 'usuarios' ? <TabUsuarios /> : <TabRoles />}
    </div>
  )
}
