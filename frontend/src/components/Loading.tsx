import { Loader2 } from 'lucide-react'

type Props = {
  label?: string
  size?: 'sm' | 'md' | 'lg'
  fullPanel?: boolean
  className?: string
}

const sizeMap = {
  sm: { icon: 'w-6 h-6',  text: 'text-sm',  gap: 'gap-2', pad: 'py-4'  },
  md: { icon: 'w-10 h-10', text: 'text-lg',  gap: 'gap-3', pad: 'py-10' },
  lg: { icon: 'w-16 h-16', text: 'text-2xl', gap: 'gap-4', pad: 'py-16' },
}

export default function Loading({
  label = 'Cargando...',
  size = 'lg',
  fullPanel = true,
  className = '',
}: Props) {
  const s = sizeMap[size]
  const container = fullPanel
    ? `w-full flex flex-col items-center justify-center ${s.pad} ${s.gap} bg-white rounded-2xl border border-gray-100 shadow-sm`
    : `w-full flex flex-col items-center justify-center ${s.pad} ${s.gap}`

  return (
    <div className={`${container} ${className}`} role="status" aria-live="polite">
      <div className="relative flex items-center justify-center">
        <span className={`absolute inline-flex rounded-full bg-blue-400/30 animate-ping ${s.icon}`} />
        <Loader2 className={`relative text-blue-600 animate-spin ${s.icon}`} strokeWidth={2.5} />
      </div>
      <div className={`font-semibold text-gray-700 tracking-wide ${s.text}`}>
        <span className="inline-block animate-pulse">{label}</span>
      </div>
    </div>
  )
}
