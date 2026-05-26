"""
Orquestador del agente Koski IA — loop agéntico con Anthropic Claude + tool use.

Modelo híbrido:
- mode="fast" → Claude Haiku 4.5 (chat operativo rápido)
- mode="deep" → Claude Sonnet 4.6 (análisis profundo con skill gerente-procesos)

El skill `gerente-procesos` se carga desde ~/.claude/skills/gerente-procesos/SKILL.md
y se inyecta en el system prompt con prompt caching (bloque cacheable + bloque dinámico).

Expone:
- run_chat: modo síncrono que devuelve el texto final (para debug en Swagger).
- stream_chat: async generator que emite eventos para SSE.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

import anthropic
from sqlalchemy.orm import Session

from models.planning import Usuario
from schemas.koski_ia import ChatMessage
from services.koski_ia_tools import ANTHROPIC_TOOLS, dispatch_tool


logger = logging.getLogger("koski_ia")


# ─────────────────────────────────────────────────────────────
# Configuración
# ─────────────────────────────────────────────────────────────

MODEL_FAST = os.getenv("KOSKI_IA_MODEL_FAST", "claude-haiku-4-5-20251001")
MODEL_DEEP = os.getenv("KOSKI_IA_MODEL_DEEP", "claude-sonnet-4-6")
MAX_ITERATIONS = 8
MAX_TOKENS_OUT = 4096

_DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


BASE_RULES = """
# Reglas operativas de Koski IA

Eres Koski IA, asistente interno de KOS Colombia (MES industrial para planeación de producción).
Responde siempre en español, tono profesional y conciso.

Tienes acceso a herramientas read-only sobre producción y planeación. Úsalas cuando necesites
datos actuales; NUNCA inventes cifras ni nombres de máquinas, OPs u operarios.

- Si el usuario no da suficiente detalle (p.ej. pide capacidad sin decir qué máquina), pide
  aclaración o usa `list_maquinas` primero para mostrar opciones.
- Cuando muestres listas largas, resume por defecto (5–10 filas) y ofrece detalle bajo demanda.
- Los IDs internos (docto, maquina_id) no los muestres salvo que ayuden al usuario; prefiere
  nombres legibles.
- Formatea con markdown cuando ayude (listas, tablas, negritas).

Interpretación de fechas relativas (la semana inicia en lunes):
- 'hoy' = la fecha de hoy.
- 'mañana' = hoy + 1 día.
- 'el lunes / martes / …' sin más contexto = el próximo día con ese nombre (incluyendo hoy si coincide).
- 'esta semana' = del lunes de esta semana al domingo.
- 'la próxima semana' = del próximo lunes al domingo siguiente.

Para preguntas sobre OPs a entregar en un día o rango, usa `list_ordenes_produccion` con
`fecha_entrega_desde` / `fecha_entrega_hasta` y `ordenar_por='fecha_entrega'`.
"""


SKILL_HEADER = """
# Rol experto: Gerente de Procesos Productivos

Cuando la pregunta del usuario sea sobre indicadores productivos, OEE, disponibilidad,
rendimiento, calidad, paradas (Pareto), capacidad, cuellos de botella, control estadístico
de procesos, análisis de tendencias o cualquier diagnóstico de la operación con datos,
**adopta el rol siguiente** y aplica su framework. Para consultas operativas simples
(listar OPs, ver máquinas, ver un Gantt) responde directo y conciso sin desplegar el framework completo.

---
"""


# ─────────────────────────────────────────────────────────────
# Carga del skill (cached en memoria del proceso)
# ─────────────────────────────────────────────────────────────

_skill_cache: Optional[str] = None


def _skill_paths() -> List[Path]:
    candidates: List[Path] = []
    # 1) Ruta canónica del usuario (Claude Code skills)
    home = Path.home()
    candidates.append(home / ".claude" / "skills" / "gerente-procesos" / "SKILL.md")
    # 2) Fallback empaquetado dentro del backend (para Docker / Azure)
    here = Path(__file__).resolve().parent.parent
    candidates.append(here / "skills" / "gerente-procesos" / "SKILL.md")
    return candidates


def _load_skill_md() -> str:
    global _skill_cache
    if _skill_cache is not None:
        return _skill_cache
    for p in _skill_paths():
        try:
            if p.exists():
                _skill_cache = p.read_text(encoding="utf-8")
                logger.info("Skill gerente-procesos cargado desde %s", p)
                return _skill_cache
        except Exception:  # noqa: BLE001
            logger.exception("Error leyendo skill en %s", p)
    logger.warning("No se encontró SKILL.md de gerente-procesos; usando solo BASE_RULES.")
    _skill_cache = ""
    return _skill_cache


# ─────────────────────────────────────────────────────────────
# System prompt (bloques estable + dinámico)
# ─────────────────────────────────────────────────────────────

def _build_system_blocks(mode: str, current_user: Usuario) -> List[Dict[str, Any]]:
    skill_md = _load_skill_md()
    estable = BASE_RULES + ("\n" + SKILL_HEADER + skill_md if skill_md else "")

    hoy_dt = datetime.utcnow()
    dinamico = (
        f"Fecha de hoy: {hoy_dt.strftime('%Y-%m-%d')} ({_DIAS_ES[hoy_dt.weekday()]}).\n"
        f"Usuario actual: {current_user.username} (rol: {current_user.rol}).\n"
        f"Modo de respuesta: {mode}."
    )

    blocks: List[Dict[str, Any]] = [
        {
            "type": "text",
            "text": estable,
            "cache_control": {"type": "ephemeral"},
        },
        {"type": "text", "text": dinamico},
    ]
    return blocks


# ─────────────────────────────────────────────────────────────
# Cliente Anthropic (singleton)
# ─────────────────────────────────────────────────────────────

_client: Optional[anthropic.Anthropic] = None
_async_client: Optional[anthropic.AsyncAnthropic] = None


def _api_key() -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY no está configurado en el entorno.")
    return api_key


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=_api_key())
    return _client


def get_async_client() -> anthropic.AsyncAnthropic:
    global _async_client
    if _async_client is None:
        _async_client = anthropic.AsyncAnthropic(api_key=_api_key())
    return _async_client


def _model_for(mode: str) -> str:
    return MODEL_DEEP if (mode or "fast").lower() == "deep" else MODEL_FAST


# ─────────────────────────────────────────────────────────────
# Conversión de historial al formato Anthropic
# ─────────────────────────────────────────────────────────────

def _to_anthropic_messages(messages: List[ChatMessage]) -> List[Dict[str, Any]]:
    """
    Convierte el historial del frontend (role: user|model) al formato Anthropic
    (role: user|assistant, content: string o lista de bloques).
    """
    out: List[Dict[str, Any]] = []
    for m in messages:
        role = "assistant" if m.role == "model" else "user"
        out.append({"role": role, "content": m.content})
    return out


# ─────────────────────────────────────────────────────────────
# Modo no-streaming
# ─────────────────────────────────────────────────────────────

def run_chat(
    messages: List[ChatMessage],
    db: Session,
    current_user: Usuario,
    mode: str = "fast",
) -> Dict[str, Any]:
    client = get_client()
    convo = _to_anthropic_messages(messages)
    tool_calls_log: List[str] = []
    system = _build_system_blocks(mode, current_user)
    model = _model_for(mode)

    for _ in range(MAX_ITERATIONS):
        resp = client.messages.create(
            model=model,
            system=system,
            tools=ANTHROPIC_TOOLS,
            messages=convo,
            max_tokens=MAX_TOKENS_OUT,
        )

        # Acumular texto del turno
        text_chunks = [b.text for b in resp.content if b.type == "text"]
        tool_uses = [b for b in resp.content if b.type == "tool_use"]

        _log_usage(resp, mode)

        if resp.stop_reason != "tool_use" or not tool_uses:
            final_text = "".join(text_chunks).strip()
            return {"text": final_text or "(respuesta vacía)", "tool_calls": tool_calls_log}

        # Añadir el turno del asistente con sus bloques tal cual
        convo.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})

        # Ejecutar tools y devolver tool_result en un mensaje user
        results_blocks: List[Dict[str, Any]] = []
        for tu in tool_uses:
            tool_calls_log.append(tu.name)
            result = dispatch_tool(db, tu.name, dict(tu.input or {}))
            results_blocks.append({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": json.dumps(result, default=str, ensure_ascii=False),
            })
        convo.append({"role": "user", "content": results_blocks})

    return {"text": "(límite de iteraciones alcanzado)", "tool_calls": tool_calls_log}


# ─────────────────────────────────────────────────────────────
# Modo streaming (SSE)
# ─────────────────────────────────────────────────────────────

async def stream_chat(
    messages: List[ChatMessage],
    db: Session,
    current_user: Usuario,
    mode: str = "fast",
) -> AsyncIterator[Dict[str, Any]]:
    """
    Genera eventos:
      - {type: "text", data: "..."}        delta de texto
      - {type: "tool_call", name: "..."}   el modelo decidió invocar una tool
      - {type: "tool_result", name: "..."} la tool terminó (sin payload)
      - {type: "end"}                      respuesta final completada
      - {type: "error", message: "..."}    error recuperable
    """
    try:
        client = get_async_client()
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": str(e)}
        yield {"type": "end"}
        return

    convo = _to_anthropic_messages(messages)
    system = _build_system_blocks(mode, current_user)
    model = _model_for(mode)

    for _ in range(MAX_ITERATIONS):
        try:
            async with client.messages.stream(
                model=model,
                system=system,
                tools=ANTHROPIC_TOOLS,
                messages=convo,
                max_tokens=MAX_TOKENS_OUT,
            ) as stream:
                async for event in stream:
                    et = getattr(event, "type", None)
                    if et == "content_block_delta":
                        delta = event.delta
                        if getattr(delta, "type", None) == "text_delta":
                            yield {"type": "text", "data": delta.text}
                    elif et == "content_block_start":
                        block = getattr(event, "content_block", None)
                        if block is not None and getattr(block, "type", None) == "tool_use":
                            yield {"type": "tool_call", "name": block.name}

                final = await stream.get_final_message()
            _log_usage(final, mode)
        except anthropic.APIError as e:
            logger.exception("Anthropic APIError en stream_chat")
            yield {"type": "error", "message": f"Error de Anthropic: {e}"}
            yield {"type": "end"}
            return
        except Exception as e:  # noqa: BLE001
            logger.exception("Error inesperado en stream_chat")
            yield {"type": "error", "message": f"Error durante streaming: {e}"}
            yield {"type": "end"}
            return

        tool_uses = [b for b in final.content if b.type == "tool_use"]

        if final.stop_reason != "tool_use" or not tool_uses:
            yield {"type": "end"}
            return

        # Añadir el turno completo del asistente al historial
        convo.append({"role": "assistant", "content": [b.model_dump() for b in final.content]})

        # Ejecutar tools (en threadpool para no bloquear el event loop con SQL)
        results_blocks: List[Dict[str, Any]] = []
        for tu in tool_uses:
            result = await asyncio.to_thread(dispatch_tool, db, tu.name, dict(tu.input or {}))
            yield {"type": "tool_result", "name": tu.name}
            results_blocks.append({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": json.dumps(result, default=str, ensure_ascii=False),
            })
        convo.append({"role": "user", "content": results_blocks})

    yield {"type": "error", "message": "Límite de iteraciones alcanzado."}
    yield {"type": "end"}


def _log_usage(final_msg: Any, mode: str) -> None:
    """Loguea uso de tokens del turno, incluyendo cache hits para verificar prompt caching."""
    try:
        u = getattr(final_msg, "usage", None)
        if u is None:
            return
        logger.info(
            "koski_ia[%s] tokens in=%s out=%s | cache_create=%s cache_read=%s | stop=%s",
            mode,
            getattr(u, "input_tokens", "?"),
            getattr(u, "output_tokens", "?"),
            getattr(u, "cache_creation_input_tokens", 0),
            getattr(u, "cache_read_input_tokens", 0),
            getattr(final_msg, "stop_reason", "?"),
        )
    except Exception:  # noqa: BLE001
        pass
