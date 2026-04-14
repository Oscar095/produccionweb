import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { getKPIs } from '../api/production'
import { getTicketsActivos } from '../api/maintenance'
import { getCapacidad } from '../api/planning'
import { AlertTriangle, CheckCircle, Clock, AlertCircle, Activity } from 'lucide-react'

function KPICard({ label, value, sub, color, Icon }: {
  label: string; value: number | string; sub?: string; color: string; Icon: React.ElementType
}) {
  return (
    <div className={`bg-white rounded-xl border-l-4 ${color} shadow-sm p-5 flex items-start gap-4`}>
      <div className={`p-2 rounded-lg ${color.replace('border-', 'bg-').replace('-500', '-100')}`}>
        <Icon size={22} className={color.replace('border-', 'text-')} />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold text-gray-800">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { data: kpis } = useQuery({ queryKey: ['kpis'], queryFn: getKPIs, refetchInterval: 300_000 })
  const { data: activos } = useQuery({ queryKey: ['tickets-activos'], queryFn: getTicketsActivos, refetchInterval: 60_000 })
  const { data: capacidades } = useQuery({ queryKey: ['capacidad'], queryFn: () => getCapacidad(), refetchInterval: 300_000 })

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Dashboard de Producción</h2>
        <p className="text-sm text-gray-500 mt-1">Vista en tiempo real — actualiza cada 5 min</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label="Completadas" value={kpis?.completadas ?? '—'}
          sub={kpis ? `${kpis.pct_completado}% del total` : undefined}
          color="border-green-500" Icon={CheckCircle}
        />
        <KPICard
          label="En Proceso" value={kpis?.en_proceso ?? '—'}
          color="border-blue-500" Icon={Activity}
        />
        <KPICard
          label="Pendientes" value={kpis?.pendientes ?? '—'}
          color="border-gray-400" Icon={Clock}
        />
        <KPICard
          label="Sin Asignar" value={kpis?.sin_asignar ?? '—'}
          sub="requieren asignación"
          color="border-yellow-500" Icon={AlertCircle}
        />
      </div>

      {/* Alertas de paradas activas */}
      {activos && activos.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-red-600" />
            <h3 className="font-semibold text-red-700">Máquinas paradas ahora ({activos.length})</h3>
          </div>
          <div className="space-y-2">
            {activos.map((t: { Id: number; maquina_nombre?: string; ticket: string; descripcion_problema?: string }) => (
              <div key={t.Id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-red-100">
                <div>
                  <span className="font-medium text-gray-800">{t.maquina_nombre}</span>
                  <span className="text-gray-400 mx-2">—</span>
                  <span className="text-sm text-gray-600">{t.ticket}: {t.descripcion_problema || 'Sin descripción'}</span>
                </div>
                <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">Parada</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capacidad por máquina */}
      {capacidades && capacidades.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Capacidad esta semana por máquina</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={capacidades} margin={{ left: 0, right: 10 }}>
              <XAxis dataKey="maquina_nombre" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `${v}h`} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(val: unknown) => [`${(val as number).toFixed(1)}h`]}
              />
              <Bar dataKey="horas_disponibles_semana" name="Disponible" fill="#93C5FD" radius={[4, 4, 0, 0]} />
              <Bar dataKey="horas_asignadas" name="Asignada" radius={[4, 4, 0, 0]}>
                {capacidades.map((entry: { sobrecargada: boolean }, i: number) => (
                  <Cell key={i} fill={entry.sobrecargada ? '#EF4444' : '#3B82F6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 mt-2">Rojo = sobrecarga. Azul = dentro de capacidad.</p>
        </div>
      )}
    </div>
  )
}
