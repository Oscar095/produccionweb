import { useQuery } from '@tanstack/react-query'
import { getKPIs, getEquipmentAvailability, getEquipmentEfficiency, getEquipmentQuality, getEquipmentOEE } from '../api/production'
import { getTicketsActivos } from '../api/maintenance'
import { getMetas } from '../api/config'
import {
  AlertTriangle, LayoutDashboard, Gauge, Factory, Zap, Target, ShieldCheck, Layers, Clock,
} from 'lucide-react'

// Tiempo transcurrido de una parada desde su fecha de inicio.
function fmtTiempoParada(fecha: string): string {
  const ms = Date.now() - new Date(fecha).getTime()
  if (isNaN(ms) || ms < 0) return '—'
  const horas = ms / 3_600_000
  if (horas < 1) return `${Math.round(ms / 60_000)} min`
  if (horas < 24) return `${horas.toFixed(1)} h`
  const dias = Math.floor(horas / 24)
  const rem = Math.round(horas % 24)
  return `${dias}d ${rem}h`
}

// ── KPI Card (matches Reports.tsx aesthetic) ─────────────────────────────────
function KpiCard({
  icon, label, value, sub, accent, meta,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  accent: string
  meta?: number
}) {
  const numericValue = typeof value === 'string' ? parseFloat(value) : value
  const metaOk = meta != null && !isNaN(numericValue) && numericValue >= meta

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-sm p-5 flex gap-4 items-start">
      <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${accent}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-slate-800 leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        {meta != null && (
          <p className={`text-xs mt-1 font-medium flex items-center gap-1 ${metaOk ? 'text-emerald-600' : 'text-amber-600'}`}>
            <Target size={11} />
            Meta: {meta.toFixed(1)}%
          </p>
        )}
      </div>
      <div className={`absolute -right-4 -bottom-4 w-20 h-20 rounded-full opacity-10 ${accent}`} />
    </div>
  )
}

export default function Dashboard({ kiosk = false }: { kiosk?: boolean } = {}) {
  const refreshMs = kiosk ? 60_000 : 300_000
  const { data: kpis } = useQuery({ queryKey: ['kpis'], queryFn: getKPIs, refetchInterval: refreshMs })
  const { data: activos } = useQuery({ queryKey: ['tickets-activos'], queryFn: getTicketsActivos, refetchInterval: kiosk ? 30_000 : 60_000 })
  const { data: disp } = useQuery({ queryKey: ['equipment-availability'], queryFn: getEquipmentAvailability, refetchInterval: refreshMs })
  const { data: efic } = useQuery({ queryKey: ['equipment-efficiency'], queryFn: getEquipmentEfficiency, refetchInterval: refreshMs })
  const { data: qual } = useQuery({ queryKey: ['equipment-quality'], queryFn: getEquipmentQuality, refetchInterval: refreshMs })
  const { data: oee } = useQuery({ queryKey: ['equipment-oee'], queryFn: getEquipmentOEE, refetchInterval: refreshMs })
  const { data: metas = [] } = useQuery<{ kpi: string; valor: number }[]>({
    queryKey: ['config-metas'],
    queryFn: getMetas,
    staleTime: 300_000,
  })

  const metaValor = (kpi: string) => metas.find(m => m.kpi === kpi)?.valor

  return (
    <div className={kiosk ? 'h-screen flex flex-col overflow-hidden bg-slate-50' : 'min-h-screen bg-slate-50'}>
      {/* ── Top gradient hero ── */}
      <div className={`bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 ${kiosk ? 'pt-4 pb-6' : 'pt-6 pb-10'}`}>

        <div className="max-w-full mx-auto">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <LayoutDashboard size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Producción</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Dashboard de Producción</h1>
              <p className="text-blue-200 text-sm mt-1">Vista en tiempo real — actualiza cada {kiosk ? '1' : '5'} min</p>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-sm rounded-xl text-white text-sm">
              <Zap size={15} className="text-emerald-300" />
              <span className="font-medium">En vivo</span>
            </div>
          </div>
        </div>
      </div>

      <div className={`px-6 max-w-full mx-auto ${kiosk ? 'flex-1 min-h-0 flex flex-col gap-3 -mt-3 pb-14' : '-mt-5 pb-10 space-y-6'}`}>

        {/* ── OEE: indicador compuesto (titular) ── */}
        {oee != null && (
          <div className="bg-gradient-to-br from-indigo-50 via-white to-violet-50 border border-indigo-100 rounded-2xl shadow-sm p-5 flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-4 flex-1 min-w-[260px]">
              <div className="w-14 h-14 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-200">
                <Layers size={28} className="text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold text-indigo-700 uppercase tracking-widest">OEE — Eficiencia Global del Equipo</p>
                <p className="text-4xl font-bold text-slate-800 leading-tight mt-0.5">{oee.oee_pct}%</p>
                <p className="text-xs text-slate-500 mt-0.5">{oee.maquinas_evaluadas} máquinas · mes en curso</p>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-center">
                <p className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">Disponibilidad</p>
                <p className="text-xl font-bold text-slate-700">{oee.disponibilidad_pct}%</p>
              </div>
              <span className="text-slate-300 text-xl font-light">×</span>
              <div className="text-center">
                <p className="text-[10px] font-semibold text-orange-700 uppercase tracking-wide">Rendimiento</p>
                <p className="text-xl font-bold text-slate-700">{oee.rendimiento_pct}%</p>
              </div>
              <span className="text-slate-300 text-xl font-light">×</span>
              <div className="text-center">
                <p className="text-[10px] font-semibold text-cyan-700 uppercase tracking-wide">Calidad</p>
                <p className="text-xl font-bold text-slate-700">{oee.calidad_pct}%</p>
              </div>
            </div>
          </div>
        )}

        {/* ── KPI cards de planta ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={<Target size={22} className="text-violet-600" />}
            label="Tasa de Servicio"
            value={kpis != null ? `${kpis.tasa_servicio}%` : '—'}
            sub={kpis != null ? `${kpis.mes_atrasadas} atrasadas de ${kpis.mes_total} del mes` : undefined}
            accent="bg-violet-100"
            meta={metaValor('tasa_servicio')}
          />
          <KpiCard
            icon={<Gauge size={22} className="text-teal-600" />}
            label="Disponibilidad Equipos"
            value={disp != null ? `${disp.disponibilidad_pct}%` : '—'}
            sub={disp != null ? `${disp.maquinas_evaluadas} máquinas · mes en curso` : undefined}
            accent="bg-teal-100"
            meta={metaValor('disponibilidad')}
          />
          <KpiCard
            icon={<Zap size={22} className="text-orange-600" />}
            label="Eficiencia Equipos"
            value={efic != null ? `${efic.eficiencia_pct}%` : '—'}
            sub={efic != null ? `producción real vs. capacidad · mes en curso` : undefined}
            accent="bg-orange-100"
            meta={metaValor('eficiencia')}
          />
          <KpiCard
            icon={<ShieldCheck size={22} className="text-cyan-600" />}
            label="Calidad Equipos"
            value={qual != null ? `${qual.calidad_pct}%` : '—'}
            sub={qual != null ? `unidades buenas vs. total · mes en curso` : undefined}
            accent="bg-cyan-100"
            meta={metaValor('calidad')}
          />
        </div>

        {/* ── Alertas de paradas activas ── */}
        {activos && activos.length > 0 && (
          <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden ${kiosk ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-rose-50 to-white flex-shrink-0">
              <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
                <AlertTriangle size={16} className="text-rose-600" />
              </div>
              <span className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                Máquinas paradas ahora
              </span>
              <span className="ml-auto inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-600 text-white">
                {activos.length}
              </span>
            </div>
            <div className={kiosk ? 'p-4 grid grid-cols-2 gap-2 overflow-hidden flex-1 min-h-0 content-start' : 'p-5 space-y-2'}>
              {activos.map((t: { Id: number; maquina_nombre?: string; ticket: string; descripcion_problema?: string; fecha: string }) => (
                <div
                  key={t.Id}
                  className="flex items-center justify-between bg-slate-50/60 hover:bg-rose-50/40 rounded-xl px-4 py-2.5 border border-slate-100 transition-colors gap-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
                      <Factory size={14} className="text-rose-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 text-sm truncate">{t.maquina_nombre}</p>
                      <p className="text-xs text-slate-500 truncate">
                        <span className="font-medium text-slate-600">{t.ticket}:</span>{' '}
                        {t.descripcion_problema || 'Sin descripción'}
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-1 rounded-full tabular-nums" title="Tiempo detenida">
                      <Clock size={11} />
                      {fmtTiempoParada(t.fecha)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-rose-100 text-rose-700 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
                      Parada
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
