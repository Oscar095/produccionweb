import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfWeek, subWeeks, addWeeks } from 'date-fns'
import { es } from 'date-fns/locale'
import { getProductionData } from '../api/reports'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

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

export default function Reports() {
  const [semana, setSemana] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [busqueda, setBusqueda] = useState('')
  const semanaStr = format(semana, "yyyy-MM-dd'T'00:00:00")

  const { data: prodData, isLoading: prodLoading } = useQuery<ProductionData>({
    queryKey: ['production', semanaStr],
    queryFn: () => getProductionData(semanaStr),
  })

  // Collect all unique machines across all days and filter by search
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
        return {
          ...maq,
          registros: filteredRegs,
          total_produccion: filteredRegs.reduce((s, r) => s + r.produccion, 0),
        }
      }).filter(Boolean) as MaquinaDia[]

      return { ...dia, maquinas: filteredMaquinas }
    })

    const machines = Array.from(machineMap.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))

    return { allMachines: machines, filteredProdData: { ...prodData, dias: filteredDias } }
  }, [prodData, busqueda])

  // Build pivot: machine -> day -> registros
  const pivotData = useMemo(() => {
    if (!filteredProdData || !allMachines.length) return null
    const pivot = new Map<number, Map<string, MaquinaDia | null>>()

    for (const m of allMachines) {
      const dayMap = new Map<string, MaquinaDia | null>()
      for (const dia of filteredProdData.dias) {
        const found = dia.maquinas.find(mq => mq.maquina_id === m.id)
        dayMap.set(dia.fecha, found || null)
      }
      pivot.set(m.id, dayMap)
    }
    return pivot
  }, [filteredProdData, allMachines])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">Reportes</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => setSemana(w => subWeeks(w, 1))}
            className="p-2 rounded-lg border hover:bg-gray-100">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium min-w-[200px] text-center">
            Semana del {format(semana, "dd 'de' MMMM yyyy", { locale: es })}
          </span>
          <button onClick={() => setSemana(w => addWeeks(w, 1))}
            className="p-2 rounded-lg border hover:bg-gray-100">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {prodLoading && <p className="text-gray-400 text-sm">Cargando datos...</p>}

      {/* Produccion */}
      {!prodLoading && filteredProdData && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar OP, item, marca, maquina..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Pivot table */}
          {pivotData && allMachines.length > 0 ? (
            <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[180px]">
                      Centro de Trabajo
                    </th>
                    {filteredProdData.dias.map(dia => (
                      <th key={dia.fecha} className="text-center px-4 py-3 font-semibold text-gray-700 min-w-[180px]">
                        {dia.dia_nombre}
                        <div className="text-xs font-normal text-gray-400">{dia.fecha}</div>
                      </th>
                    ))}
                    <th className="text-center px-4 py-3 font-semibold text-gray-700 min-w-[100px]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {allMachines.map(machine => {
                    const dayMap = pivotData.get(machine.id)
                    if (!dayMap) return null
                    // Check if machine has any data after filtering
                    const hasData = Array.from(dayMap.values()).some(v => v !== null)
                    if (busqueda && !hasData) return null

                    let machineTotal = 0
                    return (
                      <tr key={machine.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800 sticky left-0 bg-white">
                          {machine.nombre}
                        </td>
                        {filteredProdData.dias.map(dia => {
                          const maqData = dayMap.get(dia.fecha)
                          if (!maqData) return <td key={dia.fecha} className="px-4 py-3 text-center text-gray-300">-</td>
                          machineTotal += maqData.total_produccion
                          return (
                            <td key={dia.fecha} className="px-4 py-3 align-top">
                              <div className="space-y-1">
                                {maqData.registros.map((r, i) => (
                                  <div key={`${r.numero_op}-${i}`} className="text-xs">
                                    <span className="font-medium text-black">OP {r.numero_op}</span>
                                    {r.marca && <span className="text-black"> - {r.marca}</span>}
                                    <span className="text-black">: {r.produccion.toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-1 pt-1 border-t text-xs font-bold text-black">
                                {maqData.total_produccion.toLocaleString()}
                              </div>
                            </td>
                          )
                        })}
                        <td className="px-4 py-3 text-center font-bold text-black">
                          {machineTotal.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                  {/* Totals row */}
                  <tr className="bg-blue-50 font-bold">
                    <td className="px-4 py-3 sticky left-0 bg-blue-50 text-gray-800">TOTAL</td>
                    {filteredProdData.dias.map(dia => (
                      <td key={dia.fecha} className="px-4 py-3 text-center text-gray-800">
                        {dia.maquinas.reduce((s, m) => s + m.total_produccion, 0).toLocaleString()}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center text-blue-800">
                      {filteredProdData.dias.reduce((s, d) => s + d.maquinas.reduce((s2, m) => s2 + m.total_produccion, 0), 0).toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            !prodLoading && <p className="text-gray-400 text-sm">Sin datos de produccion para esta semana.</p>
          )}
        </div>
      )}
    </div>
  )
}
