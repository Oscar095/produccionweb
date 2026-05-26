/**
 * Cliente SSE para el módulo Koski IA.
 * Usa fetch + ReadableStream (EventSource no permite el header Authorization).
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

export type ChatRole = 'user' | 'model'

export type ChatMode = 'fast' | 'deep'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export type ChatEvent =
  | { type: 'text'; data: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string }
  | { type: 'end' }
  | { type: 'error'; message: string }

export interface StreamChatHandlers {
  onEvent: (ev: ChatEvent) => void
  signal?: AbortSignal
  mode?: ChatMode
}

/**
 * Envía los mensajes al backend y dispara onEvent por cada evento SSE recibido.
 * Resuelve cuando llega "end" o la respuesta termina.
 */
export async function streamChat(
  messages: ChatMessage[],
  { onEvent, signal, mode = 'fast' }: StreamChatHandlers,
): Promise<void> {
  const token = localStorage.getItem('kos_token')
  const res = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, mode }),
    signal,
  })

  if (res.status === 401) {
    localStorage.removeItem('kos_token')
    localStorage.removeItem('kos_user')
    window.location.href = '/login'
    return
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    onEvent({ type: 'error', message: `HTTP ${res.status}: ${text || res.statusText}` })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // findEventEnd: localiza la posición del separador entre eventos SSE.
  // El estándar permite \n\n, \r\n\r\n o \r\r como separador.
  const findEventEnd = (s: string): { idx: number; sepLen: number } | null => {
    const candidates = [
      { sep: '\r\n\r\n', len: 4 },
      { sep: '\n\n', len: 2 },
      { sep: '\r\r', len: 2 },
    ]
    let best = -1
    let bestLen = 0
    for (const { sep, len } of candidates) {
      const idx = s.indexOf(sep)
      if (idx !== -1 && (best === -1 || idx < best)) {
        best = idx
        bestLen = len
      }
    }
    return best === -1 ? null : { idx: best, sepLen: bestLen }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let found = findEventEnd(buffer)
    while (found) {
      const rawEvent = buffer.slice(0, found.idx)
      buffer = buffer.slice(found.idx + found.sepLen)

      // Cada línea puede ser separada por \n o \r\n; split tolerante.
      const lines = rawEvent.split(/\r?\n|\r/)
      const dataLines = lines
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())

      if (dataLines.length > 0) {
        const payload = dataLines.join('\n')
        try {
          const ev = JSON.parse(payload) as ChatEvent
          onEvent(ev)
          if (ev.type === 'end') return
        } catch (err) {
          console.warn('[koski_ia] no se pudo parsear evento SSE:', payload, err)
        }
      }
      found = findEventEnd(buffer)
    }
  }
}

/**
 * Llamada no-streaming (fallback / uso programático).
 */
export async function sendChat(
  messages: ChatMessage[],
  mode: ChatMode = 'fast',
): Promise<{ text: string; tool_calls: string[] }> {
  const token = localStorage.getItem('kos_token')
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, mode }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
