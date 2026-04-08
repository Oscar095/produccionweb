import { create } from 'zustand'
import { api } from '../api/client'

interface AuthUser {
  nombre: string
  rol: string
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
    const { access_token, rol, nombre } = res.data
    localStorage.setItem('kos_token', access_token)
    localStorage.setItem('kos_user', JSON.stringify({ nombre, rol }))
    set({ token: access_token, user: { nombre, rol } })
  },

  logout: () => {
    localStorage.removeItem('kos_token')
    localStorage.removeItem('kos_user')
    set({ token: null, user: null })
  },
}))
