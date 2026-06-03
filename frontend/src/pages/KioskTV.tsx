import { useEffect, useState } from 'react'
import { Maximize2, LayoutDashboard, GanttChartSquare } from 'lucide-react'
import Dashboard from './Dashboard'
import Gantt from './Gantt'

const ROTATE_MS = 15_000

const VIEWS = [
  { key: 'indicadores', titulo: 'Indicadores de Planta', Icon: LayoutDashboard, el: <Dashboard kiosk /> },
  { key: 'gantt',       titulo: 'Gantt de Producción',   Icon: GanttChartSquare, el: <Gantt kiosk /> },
]

export default function KioskTV() {
  const [idx, setIdx] = useState(0)
  const [now, setNow] = useState(() => new Date())

  // Rotación automática entre vistas
  useEffect(() => {
    const id = setInterval(() => setIdx(i => (i + 1) % VIEWS.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [])

  // Reloj en vivo
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(id)
  }, [])

  const activa = VIEWS[idx]

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  return (
    <div className="fixed inset-0 bg-slate-50 overflow-hidden">
      {/* Capas: ambas montadas, crossfade por opacidad */}
      {VIEWS.map((v, i) => (
        <div
          key={v.key}
          className={`absolute inset-0 overflow-auto transition-opacity duration-700 ${
            i === idx ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
          }`}
        >
          {v.el}
        </div>
      ))}

      {/* Barra inferior (overlay) */}
      <div className="absolute bottom-0 inset-x-0 z-20 pointer-events-none">
        {/* Barra de progreso de 15s (reinicia al cambiar de vista) */}
        <div className="h-1 bg-white/30">
          <div
            key={idx}
            className="h-full bg-blue-500"
            style={{ animation: `kiosk-progress ${ROTATE_MS}ms linear forwards` }}
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-6 py-2.5 bg-slate-900/85 backdrop-blur-sm text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <activa.Icon size={18} className="text-blue-300 flex-shrink-0" />
            <span className="font-semibold text-sm truncate">{activa.titulo}</span>
          </div>

          {/* Puntos indicadores */}
          <div className="flex items-center gap-2">
            {VIEWS.map((v, i) => (
              <span
                key={v.key}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i === idx ? 'bg-blue-400' : 'bg-white/30'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm font-mono tabular-nums text-blue-100">
              {now.toLocaleTimeString('es-CO')}
            </span>
            <button
              onClick={enterFullscreen}
              className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium border border-white/20 transition-colors"
              title="Pantalla completa"
            >
              <Maximize2 size={13} />
              Pantalla completa
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes kiosk-progress {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </div>
  )
}
