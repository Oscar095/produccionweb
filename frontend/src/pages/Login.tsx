import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { User, Lock, LogIn, AlertCircle, Activity, Factory, TrendingUp } from 'lucide-react'

export default function Login() {
  const login = useAuthStore(s => s.login)
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/dashboard')
    } catch {
      setError('Usuario o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left: Brand showcase (hidden on mobile) ── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 p-12 flex-col justify-between">
        {/* decorative icons */}
        <div className="absolute inset-0 pointer-events-none">
          <Factory className="absolute top-20 right-20 text-white opacity-[0.06]" size={220} />
          <Activity className="absolute bottom-32 left-16 text-white opacity-[0.05]" size={180} />
          <TrendingUp className="absolute top-1/2 left-1/3 text-white opacity-[0.04]" size={260} />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <img src="/logo.png" alt="KOS Logo" className="h-24 w-auto object-contain" />
          </div>
        </div>

        <div className="relative z-10 space-y-6">
          <div>
            <h2 className="text-5xl font-bold text-white leading-tight">
              Planeación<br />de <span className="text-blue-300">Producción</span>
            </h2>
            <p className="text-blue-200 text-sm mt-4 max-w-md leading-relaxed">
              Sistema integral para el control, seguimiento y optimización de procesos de manufactura industrial.
            </p>
          </div>

          {/* Glass feature cards */}
          <div className="grid grid-cols-3 gap-3 max-w-lg">
            <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-3">
              <Activity size={20} className="text-blue-300 mb-2" />
              <p className="text-white text-xs font-semibold">Tiempo real</p>
              <p className="text-blue-200 text-[11px]">Monitoreo continuo</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-3">
              <Factory size={20} className="text-blue-300 mb-2" />
              <p className="text-white text-xs font-semibold">Multi-planta</p>
              <p className="text-blue-200 text-[11px]">Centros de trabajo</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-3">
              <TrendingUp size={20} className="text-blue-300 mb-2" />
              <p className="text-white text-xs font-semibold">Analítica</p>
              <p className="text-blue-200 text-[11px]">Reportes visuales</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-blue-300 text-xs">
          © {new Date().getFullYear()} KOS Xpress · Manufacturing Execution System
        </div>
      </div>

      {/* ── Right: Login form ── */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <img src="/logo.png" alt="KOS Logo" className="h-20 w-auto object-contain" />
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-xl p-8">
            <div className="mb-6">
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-widest">Acceso</span>
              <h1 className="text-2xl font-bold text-slate-800 mt-1">Iniciar Sesión</h1>
              <p className="text-sm text-slate-500 mt-1">Ingresa tus credenciales para continuar</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Usuario</label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                    placeholder="Ingresa tu usuario"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Contraseña</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2">
                  <AlertCircle size={15} className="flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span>Ingresando...</span>
                ) : (
                  <>
                    <LogIn size={16} />
                    <span>Ingresar</span>
                  </>
                )}
              </button>
            </form>
          </div>

          <p className="text-xs text-slate-400 text-center mt-6">
            Sistema restringido. Acceso solo para personal autorizado.
          </p>
        </div>
      </div>
    </div>
  )
}
