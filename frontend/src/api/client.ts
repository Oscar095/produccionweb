import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
})

// Inyectar JWT en cada request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('kos_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redirigir a login si el token expira
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('kos_token')
      localStorage.removeItem('kos_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)
