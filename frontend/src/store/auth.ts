import { create } from 'zustand'
import { api } from '../api/client'

type Permiso = { ver: boolean; crear: boolean; editar: boolean; eliminar: boolean }

interface AuthUser {
  nombre: string
  rol: string
  rol_id?: number
  permisos: Record<string, Permiso>
}

interface AuthStore {
  user: AuthUser | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: JSON.parse(localStorage.getItem('kos_user') || 'null'),
  token: localStorage.getItem('kos_token'),

  login: async (username, password) => {
    const res = await api.post('/api/auth/login', { username, password })
    const { access_token, rol, nombre, rol_id, permisos } = res.data
    const user: AuthUser = { nombre, rol, rol_id, permisos: permisos ?? {} }
    localStorage.setItem('kos_token', access_token)
    localStorage.setItem('kos_user', JSON.stringify(user))
    set({ token: access_token, user })
  },

  logout: () => {
    localStorage.removeItem('kos_token')
    localStorage.removeItem('kos_user')
    set({ token: null, user: null })
  },
}))

const DEFAULT_PERMISO: Permiso = { ver: false, crear: false, editar: false, eliminar: false }

export const usePermiso = (modulo: string): Permiso => {
  const permisos = useAuthStore(s => s.user?.permisos ?? {})
  return permisos[modulo] ?? DEFAULT_PERMISO
}
