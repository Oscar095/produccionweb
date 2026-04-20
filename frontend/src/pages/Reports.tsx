import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfWeek, subWeeks, addWeeks } from 'date-fns'
import { es } from 'date-fns/locale'
import { getProductionData, generateWeeklyPDF } from '../api/reports'
import {
  ChevronLeft, ChevronRight, Search, Factory,
  BarChart3, TrendingUp, Award,
  Download, Activity, Layers,
} from 'lucide-react'
import Loading from '../components/Loading'

interface RegistroOP {
  numero_op: number
  item: string | null
  marca: string | null
  produccion: number
}

interface MaquinaDia {
  maquina_id: number
  maquina_nombre: string
  registros: RegistroOP[]
  total_produccion: number
}

interface DiaData {
  fecha: string
  dia_nombre: string
  maquinas: MaquinaDia[]
  total_dia_produccion: number
}

interface ProductionData {
  semana_inicio: string
  semana_fin: string
  dias: DiaData[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_INITIALS: Record<string, string> = {
  lunes: 'L', martes: 'M', miércoles: 'X', jueves: 'J', viernes: 'V',
  sábado: 'S', domingo: 'D',
}

function heatBg(value: number, max: number): string {
  if (!value) return ''
  const p = value / max
  if (p < 0.20) return 'bg-sky-50'
  if (p < 0.40) return 'bg-sky-100'
  if (p < 0.60) return 'bg-sky-200'
  if (p < 0.80) return 'bg-blue-200'
  return 'bg-blue-400'
}

function heatText(value: number, max: number): string {
  return value / max >= 0.8 ? 'text-white' : 'text-slate-700'
}

// ── Mini bar-chart inline component ──────────────────────────────────────────
function MiniBar({ values, max }: { values: number[]; max: number }) {
  const barMax = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-[3px] h-8">
      {values.map((v, i) => (
        <div
          key={i}
          title={v.toLocaleString()}
          className="w-3 rounded-sm transition-all"
          style={{
            height: `${Math.max(4, (v / (max || barMax)) * 32)}px`,
            background: v === 0 ? '#e2e8f0' : `hsl(${212 - (v / (max || barMax)) * 40}, 90%, ${70 - (v / (max || barMax)) * 25}%)`,
          }}
        />
      ))}
    </div>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
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
    <div className={`relative overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-sm p-5 flex gap-4 items-start`}>
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

// ── Main Component ────────────────────────────────────────────────────────────
export default function Reports() {
  const [semana, setSemana] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [busqueda, setBusqueda] = useState('')
  const [exporting, setExporting] = useState(false)

  const semanaStr = format(semana, "yyyy-MM-dd'T'00:00:00")

  const { data: prodData, isLoading } = useQuery<ProductionData>({
    queryKey: ['production', semanaStr],
    queryFn: () => getProductionData(semanaStr),
  })

  // ── Filter + derive machines ───────────────────────────────────────────────
  const { allMachines, filteredProdData } = useMemo(() => {
    if (!prodData) return { allMachines: [] as { id: number; nombre: string }[], filteredProdData: null }
    const machineMap = new Map<number, string>()
    const q = busqueda.toLowerCase().trim()

    const filteredDias = prodData.dias.map(dia => {
      const filteredMaquinas = dia.maquinas.map(maq => {
        machineMap.set(maq.maquina_id, maq.maquina_nombre)
        if (!q) return maq
        const nameMatch = maq.maquina_nombre.toLowerCase().includes(q)
        const filteredRegs = maq.registros.filter(r =>
          nameMatch ||
          String(r.numero_op).includes(q) ||
          (r.item && r.item.toLowerCase().includes(q)) ||
          (r.marca && r.marca.toLowerCase().includes(q))
        )
        if (filteredRegs.length === 0) return null
        return { ...maq, registros: filteredRegs, total_produccion: filteredRegs.reduce((s, r) => s + r.produccion, 0) }
      }).filter(Boolean) as MaquinaDia[]

      return { ...dia, maquinas: filteredMaquinas }
    })

    const machines = Array.from(machineMap.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))

    return { allMachines: machines, filteredProdData: { ...prodData, dias: filteredDias } }
  }, [prodData, busqueda])

  // ── Pivot ─────────────────────────────────────────────────────────────────
  const pivotData = useMemo(() => {
    if (!filteredProdData || !allMachines.length) return null
    const pivot = new Map<number, Map<string, MaquinaDia | null>>()
    for (const m of allMachines) {
      const dayMap = new Map<string, MaquinaDia | null>()
      for (const dia of filteredProdData.dias)
        dayMap.set(dia.fecha, dia.maquinas.find(mq => mq.maquina_id === m.id) || null)
      pivot.set(m.id, dayMap)
    }
    return pivot
  }, [filteredProdData, allMachines])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!filteredProdData) return null
    const diasTotals = filteredProdData.dias.map(d => ({
      nombre: d.dia_nombre,
      total: d.maquinas.reduce((s, m) => s + m.total_produccion, 0),
    }))
    const totalSemana = diasTotals.reduce((s, d) => s + d.total, 0)
    const activeDays = diasTotals.filter(d => d.total > 0)
    const avgDia = activeDays.length ? totalSemana / activeDays.length : 0
    const bestDay = diasTotals.reduce((b, d) => (d.total > b.total ? d : b), { nombre: '-', total: 0 })
    const maquinasActivas = allMachines.filter(m => {
      const dm = pivotData?.get(m.id)
      return dm && Array.from(dm.values()).some(Boolean)
    }).length
    return { totalSemana, avgDia, bestDay, maquinasActivas }
  }, [filteredProdData, allMachines, pivotData])

  // ── Heat-map max ─────────────────────────────────────────────────────────
  const heatMax = useMemo(() => {
    if (!filteredProdData) return 1
    return Math.max(1, ...filteredProdData.dias.flatMap(d => d.maquinas.map(m => m.total_produccion)))
  }, [filteredProdData])

  // ── Daily totals for mini-bar ─────────────────────────────────────────────
  const dailyTotals = useMemo(() =>
    filteredProdData?.dias.map(d => d.maquinas.reduce((s, m) => s + m.total_produccion, 0)) ?? [],
    [filteredProdData]
  )

  const weekMax = Math.max(...dailyTotals, 1)

  // ── Export PDF ────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await generateWeeklyPDF(semanaStr)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reporte-semana-${format(semana, 'yyyy-MM-dd')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Top gradient hero ── */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 pt-6 pb-10">
        <div className="max-w-full mx-auto">
          {/* Title row */}
          <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 size={20} className="text-blue-300" />
                <span className="text-blue-300 text-sm font-medium uppercase tracking-widest">Producción</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Reportes Semanales</h1>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting || !prodData}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-sm font-medium rounded-xl border border-white/20 transition-all backdrop-blur-sm"
            >
              <Download size={15} />
              {exporting ? 'Generando...' : 'Exportar PDF'}
            </button>
          </div>

          {/* Week navigator */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setSemana(w => subWeeks(w, 1))}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="text-center px-6 py-3 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 min-w-[260px]">
              <p className="text-white font-semibold text-lg capitalize">
                {format(semana, "'Semana del' dd 'de' MMMM", { locale: es })}
              </p>
              <p className="text-blue-200 text-xs mt-0.5">
                {format(semana, 'yyyy', { locale: es })} · {format(semana, "dd/MM", { locale: es })} – {format(addWeeks(semana, 1), "dd/MM", { locale: es })}
              </p>
            </div>
            <button
              onClick={() => setSemana(w => addWeeks(w, 1))}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 -mt-5 pb-10 max-w-full mx-auto space-y-6">

        {/* ── KPI cards ── */}
        {kpis && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<Activity size={22} className="text-blue-600" />}
              label="Producción semana"
              value={kpis.totalSemana.toLocaleString()}
              sub="unidades totales"
              accent="bg-blue-100"
            />
            <KpiCard
              icon={<Factory size={22} className="text-violet-600" />}
              label="Centros activos"
              value={String(kpis.maquinasActivas)}
              sub={`de ${allMachines.length} en total`}
              accent="bg-violet-100"
            />
            <KpiCard
              icon={<TrendingUp size={22} className="text-emerald-600" />}
              label="Promedio diario"
              value={Math.round(kpis.avgDia).toLocaleString()}
              sub="unidades / día activo"
              accent="bg-emerald-100"
            />
            <KpiCard
              icon={<Award size={22} className="text-amber-600" />}
              label="Mejor día"
              value={kpis.bestDay.total.toLocaleString()}
              sub={kpis.bestDay.nombre.charAt(0).toUpperCase() + kpis.bestDay.nombre.slice(1)}
              accent="bg-amber-100"
            />
          </div>
        )}

        {isLoading && <Loading label="Cargando datos de producción..." />}

        {!isLoading && filteredProdData && (
          <div className="space-y-4">
            {/* ── Mini-bar trend ── */}
            {dailyTotals.some(v => v > 0) && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Layers size={15} className="text-slate-400" />
                  <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Tendencia diaria</span>
                </div>
                <div className="flex items-end justify-around gap-2">
                  {filteredProdData.dias.map((dia, i) => {
                    const total = dailyTotals[i] ?? 0
                    const pct = weekMax ? total / weekMax : 0
                    const dayInitial = DAY_INITIALS[dia.dia_nombre.toLowerCase()] ?? dia.dia_nombre.charAt(0).toUpperCase()
                    return (
                      <div key={dia.fecha} className="flex flex-col items-center gap-2 flex-1 min-w-0">
                        <span className="text-xs font-semibold text-slate-500">{total > 0 ? total.toLocaleString() : '—'}</span>
                        <div className="w-full flex justify-center">
                          <div
                            className="w-8 rounded-t-lg transition-all duration-500"
                            style={{
                              height: `${Math.max(6, pct * 80)}px`,
                              background: total === 0
                                ? '#e2e8f0'
                                : `linear-gradient(to top, hsl(${220 - pct * 30}, 80%, 45%), hsl(${200 - pct * 20}, 85%, 65%))`,
                            }}
                          />
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-xs font-bold text-slate-700">{dayInitial}</span>
                          <span className="text-[10px] text-slate-400">{format(new Date(dia.fecha + 'T00:00:00'), 'dd/MM')}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Search ── */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar OP, item, marca, máquina..."
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
            </div>

            {/* ── Pivot table ── */}
            {pivotData && allMachines.length > 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Heat-map legend */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50">
                  <span className="text-xs text-slate-400 font-medium">Intensidad:</span>
                  {['bg-sky-50', 'bg-sky-100', 'bg-sky-200', 'bg-blue-200', 'bg-blue-400'].map((cls, i) => (
                    <div key={i} className={`w-4 h-4 rounded ${cls} border border-slate-200`} />
                  ))}
                  <span className="text-[10px] text-slate-400">baja → alta</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-max">
                    <thead>
                      <tr className="border-b border-slate-100">
                        {/* Machine col */}
                        <th className="text-left px-5 py-4 font-semibold text-slate-600 sticky left-0 bg-white min-w-[200px] z-10 border-r border-slate-100">
                          Centro de Trabajo
                        </th>
                        {filteredProdData.dias.map((dia, i) => {
                          const dayTotal = dailyTotals[i] ?? 0
                          const dayInitial = DAY_INITIALS[dia.dia_nombre.toLowerCase()] ?? dia.dia_nombre.charAt(0).toUpperCase()
                          return (
                            <th key={dia.fecha} className="text-center px-4 py-3 font-semibold text-slate-600 min-w-[160px]">
                              <div className="flex flex-col items-center gap-1.5">
                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center">
                                  {dayInitial}
                                </div>
                                <span className="capitalize text-slate-700">{dia.dia_nombre}</span>
                                <span className="text-[10px] font-normal text-slate-400">{format(new Date(dia.fecha + 'T00:00:00'), 'dd/MM')}</span>
                                <MiniBar values={filteredProdData.dias.map((_, j) => dailyTotals[j] ?? 0)} max={weekMax} />
                                <span className="text-xs font-bold text-slate-500">{dayTotal > 0 ? dayTotal.toLocaleString() : '—'}</span>
                              </div>
                            </th>
                          )
                        })}
                        <th className="text-center px-5 py-4 font-semibold text-slate-600 min-w-[110px]">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {allMachines.map((machine, idx) => {
                        const dayMap = pivotData.get(machine.id)
                        if (!dayMap) return null
                        const hasData = Array.from(dayMap.values()).some(Boolean)
                        if (busqueda && !hasData) return null

                        let machineTotal = 0
                        const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'

                        return (
                          <tr
                            key={machine.id}
                            className={`border-b border-slate-100 ${rowBg} transition-colors hover:bg-blue-50/40`}
                          >
                            {/* Machine name */}
                            <td className={`px-5 py-3 sticky left-0 z-10 border-r border-slate-100 ${rowBg}`}>
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                                  <Factory size={13} className="text-blue-600" />
                                </div>
                                <span className="font-medium text-slate-700 text-sm leading-tight">
                                  {machine.nombre}
                                </span>
                              </div>
                            </td>

                            {/* Day cells */}
                            {filteredProdData.dias.map(dia => {
                              const maqData = dayMap.get(dia.fecha)
                              if (!maqData) {
                                return (
                                  <td key={dia.fecha} className="px-3 py-3 text-center text-slate-200 text-lg">
                                    ·
                                  </td>
                                )
                              }
                              machineTotal += maqData.total_produccion
                              const heatCls = heatBg(maqData.total_produccion, heatMax)
                              const textCls = heatText(maqData.total_produccion, heatMax)
                              return (
                                <td key={dia.fecha} className={`px-3 py-2 align-top transition-colors`}>
                                  <div className={`rounded-xl p-2 ${heatCls}`}>
                                    {/* Total badge */}
                                    <div className={`text-base font-bold text-center mb-1 ${textCls}`}>
                                      {maqData.total_produccion.toLocaleString()}
                                    </div>
                                    {/* OP detail — always visible */}
                                    <div className="space-y-1 mt-1 border-t border-white/40 pt-1">
                                      {maqData.registros.map((r, i) => (
                                        <div
                                          key={`${r.numero_op}-${i}`}
                                          className="flex flex-col bg-white/70 rounded-lg px-2 py-1"
                                        >
                                          <span className="text-[13px] font-bold text-slate-700">OP {r.numero_op}</span>
                                          {r.marca && <span className="text-[13px] text-slate-500">{r.marca}</span>}
                                          <span className="text-[13px] font-semibold text-blue-700">{r.produccion.toLocaleString()} uds</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              )
                            })}

                            {/* Machine total */}
                            <td className="px-5 py-3 text-center">
                              <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-bold ${machineTotal > 0 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                {machineTotal.toLocaleString()}
                              </span>
                            </td>
                          </tr>
                        )
                      })}

                      {/* Totals footer */}
                      <tr className="border-t-2 border-slate-200 bg-slate-800">
                        <td className="px-5 py-4 sticky left-0 bg-slate-800 z-10 border-r border-slate-700">
                          <span className="text-sm font-bold text-white uppercase tracking-wide">Total semana</span>
                        </td>
                        {filteredProdData.dias.map((dia, i) => {
                          const t = dailyTotals[i] ?? 0
                          return (
                            <td key={dia.fecha} className="px-3 py-4 text-center">
                              <span className="text-base font-bold text-white">{t > 0 ? t.toLocaleString() : '—'}</span>
                            </td>
                          )
                        })}
                        <td className="px-5 py-4 text-center">
                          <span className="text-lg font-extrabold text-blue-300">
                            {(kpis?.totalSemana ?? 0).toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              !isLoading && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                  <BarChart3 size={40} className="mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-400 font-medium">Sin datos de producción para esta semana.</p>
                  <p className="text-slate-300 text-sm mt-1">Prueba navegando a otra semana.</p>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
