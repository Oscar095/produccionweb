import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUsuarios, createUsuario, updateUsuario, deleteUsuario, resetPassword } from '../api/users'
import { UserPlus, Pencil, KeyRound, UserX, X, Check } from 'lucide-react'

type Usuario = {
  id: number; username: string; nombre: string; rol: string; activo: boolean
}

const ROL_COLOR: Record<string, string> = {
  admin:      'bg-purple-100 text-purple-700',
  supervisor: 'bg-blue-100 text-blue-700',
  operador:   'bg-gray-100 text-gray-600',
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

const INPUT = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'
const SELECT = `${INPUT} bg-white`

export default function Usuarios() {
  const qc = useQueryClient()
  const { data: usuarios = [], isLoading } = useQuery<Usuario[]>({
    queryKey: ['usuarios'],
    queryFn: getUsuarios,
  })

  const [modal, setModal] = useState<'nuevo' | 'editar' | 'password' | null>(null)
  const [selected, setSelected] = useState<Usuario | null>(null)

  // Form state — nuevo usuario
  const [nuevoForm, setNuevoForm] = useState({ username: '', nombre: '', password: '', rol: 'operador' })
  // Form state — editar
  const [editForm, setEditForm] = useState({ nombre: '', rol: 'operador', activo: true })
  // Form state — reset password
  const [newPwd, setNewPwd] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['usuarios'] })

  const mutCreate = useMutation({
    mutationFn: createUsuario,
    onSuccess: () => { invalidate(); setModal(null); setNuevoForm({ username: '', nombre: '', password: '', rol: 'operador' }) },
  })

  const mutUpdate = useMutation({
    mutationFn: ({ id, data }: { id: number; data: unknown }) => updateUsuario(id, data),
    onSuccess: () => { invalidate(); setModal(null) },
  })

  const mutDelete = useMutation({
    mutationFn: (id: number) => deleteUsuario(id),
    onSuccess: invalidate,
  })

  const mutReset = useMutation({
    mutationFn: ({ id, pwd }: { id: number; pwd: string }) => resetPassword(id, pwd),
    onSuccess: () => { invalidate(); setModal(null); setNewPwd('') },
  })

  const openEdit = (u: Usuario) => {
    setSelected(u)
    setEditForm({ nombre: u.nombre, rol: u.rol, activo: u.activo })
    setModal('editar')
  }

  const openReset = (u: Usuario) => {
    setSelected(u)
    setNewPwd('')
    setModal('password')
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Usuarios y Roles</h2>
        <button
          onClick={() => setModal('nuevo')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
        >
          <UserPlus size={16} /> Nuevo Usuario
        </button>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Cargando...</p>}

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Nombre', 'Username', 'Rol', 'Estado', 'Acciones'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {usuarios.map(u => (
              <tr key={u.id} className={`hover:bg-gray-50 transition ${!u.activo ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-medium text-gray-800">{u.nombre}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROL_COLOR[u.rol] || 'bg-gray-100 text-gray-500'}`}>
                    {u.rol}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs flex items-center gap-1 ${u.activo ? 'text-green-600' : 'text-gray-400'}`}>
                    {u.activo ? <><Check size={12} /> Activo</> : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(u)}
                      title="Editar"
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => openReset(u)}
                      title="Cambiar contraseña"
                      className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded-lg transition"
                    >
                      <KeyRound size={14} />
                    </button>
                    {u.activo && (
                      <button
                        onClick={() => { if (confirm(`¿Desactivar a ${u.nombre}?`)) mutDelete.mutate(u.id) }}
                        title="Desactivar"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <UserX size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && !isLoading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin usuarios</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Nuevo Usuario */}
      {modal === 'nuevo' && (
        <Modal title="Nuevo Usuario" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nombre completo">
              <input className={INPUT} value={nuevoForm.nombre}
                onChange={e => setNuevoForm(f => ({ ...f, nombre: e.target.value }))} />
            </Field>
            <Field label="Username">
              <input className={INPUT} value={nuevoForm.username}
                onChange={e => setNuevoForm(f => ({ ...f, username: e.target.value }))} />
            </Field>
            <Field label="Contraseña">
              <input type="password" className={INPUT} value={nuevoForm.password}
                onChange={e => setNuevoForm(f => ({ ...f, password: e.target.value }))} />
            </Field>
            <Field label="Rol">
              <select className={SELECT} value={nuevoForm.rol}
                onChange={e => setNuevoForm(f => ({ ...f, rol: e.target.value }))}>
                <option value="operador">Operador</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <button
              onClick={() => mutCreate.mutate(nuevoForm)}
              disabled={mutCreate.isPending || !nuevoForm.username || !nuevoForm.password || !nuevoForm.nombre}
              className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {mutCreate.isPending ? 'Creando...' : 'Crear Usuario'}
            </button>
            {mutCreate.isError && <p className="text-red-500 text-xs text-center">Error al crear usuario</p>}
          </div>
        </Modal>
      )}

      {/* Modal: Editar */}
      {modal === 'editar' && selected && (
        <Modal title={`Editar: ${selected.username}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nombre completo">
              <input className={INPUT} value={editForm.nombre}
                onChange={e => setEditForm(f => ({ ...f, nombre: e.target.value }))} />
            </Field>
            <Field label="Rol">
              <select className={SELECT} value={editForm.rol}
                onChange={e => setEditForm(f => ({ ...f, rol: e.target.value }))}>
                <option value="operador">Operador</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Estado">
              <select className={SELECT} value={editForm.activo ? 'true' : 'false'}
                onChange={e => setEditForm(f => ({ ...f, activo: e.target.value === 'true' }))}>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </Field>
            <button
              onClick={() => mutUpdate.mutate({ id: selected.id, data: editForm })}
              disabled={mutUpdate.isPending}
              className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {mutUpdate.isPending ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal: Reset Password */}
      {modal === 'password' && selected && (
        <Modal title={`Cambiar contraseña: ${selected.username}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nueva contraseña">
              <input type="password" className={INPUT} value={newPwd}
                onChange={e => setNewPwd(e.target.value)} />
            </Field>
            <button
              onClick={() => mutReset.mutate({ id: selected.id, pwd: newPwd })}
              disabled={mutReset.isPending || !newPwd}
              className="w-full py-2 bg-yellow-500 text-white rounded-lg text-sm hover:bg-yellow-600 disabled:opacity-50 transition"
            >
              {mutReset.isPending ? 'Cambiando...' : 'Cambiar Contraseña'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
