import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Sparkles, User, Wrench, Loader2, Trash2, BrainCircuit, Zap } from 'lucide-react'
import { streamChat, type ChatMessage, type ChatEvent, type ChatMode } from '../api/koski_ia'
import { useAuthStore } from '../store/auth'

type UiMessage = ChatMessage & {
  toolCalls?: string[]
  pending?: boolean
}

const SUGERENCIAS_FAST = [
  '¿Cuántas OPs están activas hoy?',
  '¿Cuál es la capacidad de las máquinas esta semana?',
  '¿Hay órdenes en riesgo?',
  'Muéstrame las paradas programadas futuras',
]

const SUGERENCIAS_DEEP = [
  'Calcula el OEE de cada máquina en el último mes',
  'Dame el Pareto de paradas de este mes',
  '¿Cuál es la descriptiva del throughput por máquina esta semana?',
  '¿El proceso está bajo control? Aplica reglas Western Electric',
]

const MODE_STORAGE_KEY = 'kos_chat_mode'

export default function Chat() {
  const user = useAuthStore((s) => s.user)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [mode, setMode] = useState<ChatMode>(() => {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    return stored === 'deep' ? 'deep' : 'fast'
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  }, [mode])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (prompt: string) => {
    const text = prompt.trim()
    if (!text || streaming) return
    setInput('')

    const history: ChatMessage[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'model', content: '', pending: true, toolCalls: [] },
    ])
    setStreaming(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    const onEvent = (ev: ChatEvent) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.role !== 'model') return prev

        let updated: UiMessage
        if (ev.type === 'text') {
          updated = { ...last, content: last.content + ev.data }
        } else if (ev.type === 'tool_call') {
          updated = { ...last, toolCalls: [...(last.toolCalls ?? []), ev.name] }
        } else if (ev.type === 'tool_result') {
          return prev
        } else if (ev.type === 'error') {
          updated = { ...last, content: last.content + `\n\n⚠️ ${ev.message}`, pending: false }
        } else if (ev.type === 'end') {
          updated = { ...last, pending: false }
        } else {
          return prev
        }
        return [...prev.slice(0, -1), updated]
      })
    }

    try {
      await streamChat(history, { onEvent, signal: ctrl.signal, mode })
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') {
        onEvent({ type: 'error', message: (e as Error).message || 'Error de red' })
      }
    } finally {
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.role !== 'model' || !last.pending) return prev
        return [...prev.slice(0, -1), { ...last, pending: false }]
      })
      setStreaming(false)
      abortRef.current = null
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    send(input)
  }

  const handleClear = () => {
    if (streaming) abortRef.current?.abort()
    setMessages([])
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-800 via-blue-900 to-blue-800 px-6 py-5 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={18} className="text-blue-300" />
              <span className="text-blue-300 text-xs font-medium uppercase tracking-widest">Asistente IA</span>
            </div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Bot size={26} /> Koski IA
            </h1>
            <p className="text-blue-200 text-sm mt-0.5">
              {mode === 'deep'
                ? 'Modo análisis · Claude Sonnet 4.6 + Gerente de Procesos'
                : 'Modo rápido · Claude Haiku 4.5'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white/10 border border-white/20 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => !streaming && setMode('fast')}
                disabled={streaming}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition ${
                  mode === 'fast' ? 'bg-white text-slate-800 font-semibold' : 'text-blue-100 hover:bg-white/10'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Haiku 4.5 — chat operativo rápido"
              >
                <Zap size={13} /> Rápido
              </button>
              <button
                type="button"
                onClick={() => !streaming && setMode('deep')}
                disabled={streaming}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition ${
                  mode === 'deep' ? 'bg-white text-slate-800 font-semibold' : 'text-blue-100 hover:bg-white/10'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Sonnet 4.6 — análisis profundo con el skill gerente-procesos"
              >
                <BrainCircuit size={13} /> Análisis
              </button>
            </div>
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-sm transition"
              >
                <Trash2 size={14} /> Nueva conversación
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-10">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-100 mb-4">
                <Bot size={32} className="text-blue-700" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800">Hola {user?.nombre?.split(' ')[0] ?? ''} 👋</h2>
              <p className="text-sm text-slate-500 mt-1 mb-6">
                {mode === 'deep'
                  ? 'Modo análisis activo — pídeme OEE, Pareto, descriptiva o tendencias.'
                  : 'Pregúntame sobre producción, máquinas, capacidad o planeación.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mx-auto">
                {(mode === 'deep' ? SUGERENCIAS_DEEP : SUGERENCIAS_FAST).map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left px-4 py-3 bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl text-sm text-slate-700 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 bg-white px-4 md:px-8 py-4 shrink-0">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder="Pregunta algo a Koski IA…"
            disabled={streaming}
            rows={1}
            className="flex-1 resize-none px-4 py-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-sm disabled:bg-slate-100"
            style={{ maxHeight: 140 }}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="px-4 py-3 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-white rounded-xl transition flex items-center gap-2"
          >
            {streaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </form>
        <p className="text-xs text-slate-400 text-center mt-2">
          Las respuestas pueden contener errores. Valida datos críticos con los módulos correspondientes.
        </p>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: UiMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="shrink-0 w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
          <Bot size={18} className="text-blue-700" />
        </div>
      )}
      <div className={`max-w-[85%] ${isUser ? 'order-1' : ''}`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isUser ? 'bg-blue-700 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
          }`}
        >
          {msg.content || (msg.pending ? <span className="text-slate-400 italic">Pensando…</span> : null)}
        </div>
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {msg.toolCalls.map((name, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] bg-slate-100 text-slate-600 rounded-full"
              >
                <Wrench size={10} /> {name}
              </span>
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="shrink-0 w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center">
          <User size={18} className="text-slate-600" />
        </div>
      )}
    </div>
  )
}
