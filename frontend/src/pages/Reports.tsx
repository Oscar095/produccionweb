import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { format, startOfWeek, subWeeks, addWeeks } from 'date-fns'
import { es } from 'date-fns/locale'
import { getWeeklyData, generateWeeklyPDF } from '../api/reports'
import { ChevronLeft, ChevronRight, Download, AlertTriangle, CheckCircle } from 'lucide-react'

export default function Reports() {
  const [semana, setSemana] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const semanaStr = format(semana, "yyyy-MM-dd'T'00:00:00")

  const { data, isLoading } = useQuery({
    queryKey: ['weekly', semanaStr],
    queryFn: () => getWeeklyData(semanaStr),
  })

  const mutPDF = useMutation({
    mutationFn: () => generateWeeklyPDF(semanaStr),
    onSuccess: (blob: Blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `resumen_${format(semana, 'yyyy-MM-dd')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    },
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Resumen Semanal</h2>
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
          <button
            onClick={() => mutPDF.mutate()}
            disabled={mutPDF.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-50 transition"
          >
            <Download size={16} />
            {mutPDF.isPending ? 'Generando...' : 'Descargar PDF'}
          </button>
        </div>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Cargando datos...</p>}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Capacidad */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-4">Capacidad por máquina</h3>
            <div className="space-y-3">
              {data.capacidades?.map((c: {
                maquina_nombre: string; horas_disponibles_semana: number
                horas_asignadas: number; horas_paradas: number; sobrecargada: boolean
              }) => (
                <div key={c.maquina_nombre} className="text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="font-medium">{c.maquina_nombre}</span>
                    <span className={c.sobrecargada ? 'text-red-600 font-bold' : 'text-gray-500'}>
                      {c.horas_asignadas.toFixed(1)}h / {c.horas_disponibles_semana.toFixed(1)}h
                      {c.sobrecargada && ' ⚠'}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.sobrecargada ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min((c.horas_asignadas / Math.max(c.horas_disponibles_semana, 1)) * 100, 100)}%` }}
                    />
                  </div>
                  {c.horas_paradas > 0 && (
                    <p className="text-xs text-red-500 mt-0.5">{c.horas_paradas.toFixed(1)}h en paradas</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* KPIs resumen */}
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle size={18} className="text-green-600" />
                <h3 className="font-semibold text-green-800">
                  Órdenes alcanzables esta semana ({data.total_alcanzables})
                </h3>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {data.ordenes_semana?.map((o: { op_docto: number; maquina: string; item: string; horas_requeridas: number }) => (
                  <div key={o.op_docto} className="flex justify-between text-sm text-green-800">
                    <span>OP {o.op_docto} — {o.item}</span>
                    <span className="text-green-600">{o.horas_requeridas.toFixed(1)}h</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={18} className="text-red-600" />
                <h3 className="font-semibold text-red-800">
                  Órdenes en riesgo ({data.total_en_riesgo})
                </h3>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {data.ordenes_riesgo?.map((o: { op_docto: number; maquina: string; item: string; horas_requeridas: number; horas_disponibles: number }) => (
                  <div key={o.op_docto} className="text-sm text-red-800">
                    <div className="flex justify-between">
                      <span>OP {o.op_docto} — {o.item}</span>
                      <span>Req: {o.horas_requeridas.toFixed(1)}h / Disp: {o.horas_disponibles.toFixed(1)}h</span>
                    </div>
                  </div>
                ))}
                {data.total_en_riesgo === 0 && (
                  <p className="text-sm text-red-600">Sin órdenes en riesgo</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
