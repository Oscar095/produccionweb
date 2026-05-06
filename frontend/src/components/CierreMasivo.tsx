import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Search, Loader2, AlertCircle, ListChecks, Package,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import { getOpsAbiertas, cerrarOPsMasivo, triggerRefreshWebhook, OpAbierta } from '../api/planning'

type SortKey =
  | 'docto' | 'item' | 'marca' | 'ruta_op'
  | 'cantidad' | 'cant_consumida'
  | 'f851_fecha_terminacion' | 'created_at'
type SortDir = 'asc' | 'desc'

const fmtFecha = (iso?: string | null) => {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'd MMM yyyy', { locale: es })
  } catch {
    return '—'
  }
}

const compareValues = (a: unknown, b: unknown, key: SortKey): number => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (key === 'f851_fecha_terminacion' || key === 'created_at') {
    return new Date(a as string).getTime() - new Date(b as string).getTime()
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' })
}

export default function CierreMasivo() {
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [busqueda, setBusqueda] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('f851_fecha_terminacion')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data: ops = [], isLoading, error } = useQuery<OpAbierta[]>({
    queryKey: ['ops-abiertas'],
    queryFn: getOpsAbiertas,
  })

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const filtradas = q
      ? ops.filter(o =>
          String(o.docto).includes(q) ||
          (o.item ?? '').toLowerCase().includes(q) ||
          (o.marca ?? '').toLowerCase().includes(q)
        )
      : ops
    const sorted = [...filtradas].sort((a, b) => {
      const cmp = compareValues(a[sortKey], b[sortKey], sortKey)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [ops, busqueda, sortKey, sortDir])

  const mutCerrar = useMutation({
    mutationFn: (doctos: number[]) => cerrarOPsMasivo(doctos),
    onSettled: async (resp, err) => {
      if (err) {
        const detail = (err as any)?.response?.data?.detail
        const msg = typeof detail === 'string'
          ? detail
          : JSON.stringify(detail ?? (err as any)?.message ?? 'Error desconocido')
        alert(`Error al cerrar las OPs:\n${msg}`)
      } else if (resp) {
        alert(`${resp.enviados} OP(s) enviadas a Siesa. Actualizando...`)
      }
      try { await triggerRefreshWebhook() } catch { /* ignorar fallo del webhook */ }
      await new Promise(r => setTimeout(r, 5000))
      window.location.reload()
    },
  })

  const toggleOne = (docto: number) => {
    setSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(docto)) next.delete(docto)
      else next.add(docto)
      return next
    })
  }

  const onCerrar = () => {
    const doctos = Array.from(seleccion)
    if (!doctos.length) return
    if (!confirm(`Vas a cerrar ${doctos.length} OP(s). ¿Continuar?`)) return
    mutCerrar.mutate(doctos)
  }

  const onSortClick = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const totalSeleccionadas = seleccion.size

  const SortHeader = ({
    label, k, align = 'left',
  }: { label: string; k: SortKey; align?: 'left' | 'right' }) => {
    const active = sortKey === k
    const Icon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
    return (
      <th
        onClick={() => onSortClick(k)}
        className={`px-3 py-2 cursor-pointer select-none hover:bg-slate-100 transition-colors ${
          align === 'right' ? 'text-right' : 'text-left'
        }`}
      >
        <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          {label}
          <Icon size={12} className={active ? 'text-emerald-600' : 'text-slate-300'} />
        </span>
      </th>
    )
  }

  return (
    <div className="max-w-full mx-auto px-6 -mt-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <ListChecks size={18} className="text-emerald-600" />
            <h2 className="text-lg font-semibold text-slate-800">Cierre Masivo de OPs</h2>
            <span className="text-xs text-slate-500">
              ({visibles.length} {visibles.length === 1 ? 'orden' : 'órdenes'} visible{visibles.length === 1 ? '' : 's'})
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por OP, item o marca…"
                className="pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 w-72"
              />
            </div>
            <button
              onClick={onCerrar}
              disabled={!totalSeleccionadas || mutCerrar.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-all shadow-sm"
            >
              {mutCerrar.isPending
                ? <Loader2 size={15} className="animate-spin" />
                : <ListChecks size={15} />}
              Cerrar {totalSeleccionadas} seleccionada{totalSeleccionadas === 1 ? '' : 's'}
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="p-10 flex items-center justify-center text-slate-500 text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> Cargando órdenes…
          </div>
        )}

        {error && (
          <div className="p-6 flex items-center gap-2 text-rose-600 text-sm">
            <AlertCircle size={16} /> No se pudo cargar el listado.
          </div>
        )}

        {!isLoading && !error && visibles.length === 0 && (
          <div className="p-10 flex flex-col items-center text-slate-400 text-sm">
            <Package size={32} className="mb-2" />
            {ops.length === 0 ? 'No hay OPs abiertas.' : 'Sin resultados para la búsqueda.'}
          </div>
        )}

        {!isLoading && !error && visibles.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 w-10"></th>
                  <SortHeader label="OP" k="docto" />
                  <SortHeader label="Item" k="item" />
                  <SortHeader label="Marca" k="marca" />
                  <SortHeader label="Ruta" k="ruta_op" />
                  <SortHeader label="Cant." k="cantidad" align="right" />
                  <SortHeader label="Consumida" k="cant_consumida" align="right" />
                  <SortHeader label="F. Terminación" k="f851_fecha_terminacion" />
                  <SortHeader label="Creada" k="created_at" />
                </tr>
              </thead>
              <tbody>
                {visibles.map(op => {
                  const checked = seleccion.has(op.docto)
                  return (
                    <tr
                      key={op.docto}
                      onClick={() => toggleOne(op.docto)}
                      className={`border-t border-slate-100 cursor-pointer transition-colors ${
                        checked ? 'bg-emerald-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(op.docto)}
                          onClick={e => e.stopPropagation()}
                          className="w-4 h-4 accent-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold text-slate-800">{op.docto}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-xs truncate" title={op.item ?? ''}>
                        {op.item ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{op.marca ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600 text-xs">{op.ruta_op ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{op.cantidad ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{op.cant_consumida ?? 0}</td>
                      <td className="px-3 py-2 text-slate-600">{fmtFecha(op.f851_fecha_terminacion)}</td>
                      <td className="px-3 py-2 text-slate-500">{fmtFecha(op.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
