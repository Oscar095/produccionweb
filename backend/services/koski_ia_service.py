"""
Orquestador del agente Koski IA — loop agéntico con Gemini 2.5 + function calling.

Expone dos funciones principales:
- run_chat: modo síncrono que devuelve el texto final (para debug en Swagger).
- stream_chat: async generator que emite eventos para SSE.

El loop: modelo responde → si hay function_calls, las dispatchamos → se agregan
los function_response al contexto → volvemos a llamar al modelo. Hasta 8 iteraciones.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, AsyncIterator, Dict, List

from google import genai
from google.genai import types
from sqlalchemy.orm import Session

from models.planning import Usuario
from schemas.koski_ia import ChatMessage
from services.koski_ia_tools import FUNCTION_DECLARATIONS, dispatch_tool


# ─────────────────────────────────────────────────────────────
# Configuración
# ─────────────────────────────────────────────────────────────

MODEL = os.getenv("KOSKI_IA_MODEL", "gemini-2.5-flash")
MAX_ITERATIONS = 8


def _build_system_instruction() -> str:
    hoy_dt = datetime.utcnow()
    hoy = hoy_dt.strftime("%Y-%m-%d")
    dia_semana_es = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][hoy_dt.weekday()]
    return (
        "Eres Koski IA, asistente interno de KOS Colombia (MES industrial para planeación de producción).\n"
        f"Fecha de hoy: {hoy} ({dia_semana_es}).\n\n"
        "Responde en español, tono profesional y conciso.\n"
        "Tienes acceso a herramientas read-only sobre producción y planeación. "
        "Úsalas cuando necesites datos actuales; NUNCA inventes cifras.\n"
        "Si el usuario no da suficiente detalle (p.ej. pide capacidad sin decir qué máquina), pide aclaración o usa list_maquinas primero.\n"
        "Cuando muestres listas largas, resume por defecto (5–10 filas) y ofrece detalle bajo demanda.\n"
        "Los IDs internos (docto, maquina_id) no los muestres salvo que ayuden al usuario; prefiere nombres legibles.\n"
        "Formatea con markdown cuando ayude (listas, tablas, negritas).\n\n"
        "Interpretación de fechas relativas (la semana inicia en lunes):\n"
        "- 'hoy' = la fecha de hoy.\n"
        "- 'mañana' = hoy + 1 día.\n"
        "- 'el lunes / martes / …' sin más contexto = el próximo día con ese nombre (incluyendo hoy si coincide).\n"
        "- 'esta semana' = del lunes de esta semana al domingo.\n"
        "- 'la próxima semana' = del próximo lunes al domingo siguiente.\n"
        "Cuando el usuario pregunte por OPs a entregar en un día o rango específico, usa "
        "list_ordenes_produccion con fecha_entrega_desde / fecha_entrega_hasta y ordenar_por='fecha_entrega'."
    )


def _tools() -> List[types.Tool]:
    declarations = [types.FunctionDeclaration(**fd) for fd in FUNCTION_DECLARATIONS]
    return [types.Tool(function_declarations=declarations)]


def _config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=_build_system_instruction(),
        tools=_tools(),
        temperature=0.2,
    )


_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY no está configurado en el entorno.")
        _client = genai.Client(api_key=api_key)
    return _client


# ─────────────────────────────────────────────────────────────
# Construcción del historial en formato Gemini
# ─────────────────────────────────────────────────────────────

def _build_contents(messages: List[ChatMessage], current_user: Usuario) -> List[types.Content]:
    contents: List[types.Content] = []
    for i, m in enumerate(messages):
        role = "user" if m.role == "user" else "model"
        text = m.content
        # Prefijar el primer mensaje del usuario con su contexto (no cacheado)
        if i == 0 and role == "user":
            text = f"[Contexto: usuario={current_user.username}, rol={current_user.rol}]\n{text}"
        contents.append(types.Content(role=role, parts=[types.Part(text=text)]))
    return contents


# ─────────────────────────────────────────────────────────────
# Modo no-streaming
# ─────────────────────────────────────────────────────────────

def run_chat(messages: List[ChatMessage], db: Session, current_user: Usuario) -> Dict[str, Any]:
    client = get_client()
    contents = _build_contents(messages, current_user)
    tool_calls_log: List[str] = []

    for _ in range(MAX_ITERATIONS):
        response = client.models.generate_content(model=MODEL, contents=contents, config=_config())
        if not response.candidates:
            return {"text": "(sin respuesta del modelo)", "tool_calls": tool_calls_log}

        cand = response.candidates[0]
        parts = list(cand.content.parts or [])

        fn_calls = [p.function_call for p in parts if getattr(p, "function_call", None)]
        if not fn_calls:
            text = "".join(p.text for p in parts if getattr(p, "text", None))
            return {"text": text.strip() or "(respuesta vacía)", "tool_calls": tool_calls_log}

        contents.append(cand.content)
        tool_parts: List[types.Part] = []
        for fc in fn_calls:
            args = dict(fc.args) if fc.args else {}
            tool_calls_log.append(fc.name)
            result = dispatch_tool(fc.name, args, db, current_user)
            tool_parts.append(types.Part.from_function_response(name=fc.name, response=result))
        contents.append(types.Content(role="user", parts=tool_parts))

    return {"text": "(límite de iteraciones alcanzado)", "tool_calls": tool_calls_log}


# ─────────────────────────────────────────────────────────────
# Modo streaming (SSE)
# ─────────────────────────────────────────────────────────────

async def stream_chat(
    messages: List[ChatMessage],
    db: Session,
    current_user: Usuario,
) -> AsyncIterator[Dict[str, Any]]:
    """
    Genera eventos:
      - {type: "text", data: "..."}     delta de texto
      - {type: "tool_call", name: "..."} el modelo decidió invocar una tool
      - {type: "tool_result", name: "..."} la tool terminó (sin enviar su payload, solo señal)
      - {type: "end"}                   respuesta final completada
      - {type: "error", message: "..."} error recuperable
    """
    try:
        client = get_client()
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": str(e)}
        return

    contents = _build_contents(messages, current_user)

    for _ in range(MAX_ITERATIONS):
        model_parts: List[types.Part] = []
        fn_calls: List[Any] = []

        try:
            stream = client.models.generate_content_stream(
                model=MODEL, contents=contents, config=_config()
            )
        except Exception as e:  # noqa: BLE001
            yield {"type": "error", "message": f"Error llamando a Gemini: {e}"}
            return

        try:
            for chunk in stream:
                if not chunk.candidates:
                    continue
                cand = chunk.candidates[0]
                if not cand.content or not cand.content.parts:
                    continue
                for p in cand.content.parts:
                    if getattr(p, "text", None):
                        yield {"type": "text", "data": p.text}
                        model_parts.append(types.Part(text=p.text))
                    elif getattr(p, "function_call", None):
                        fc = p.function_call
                        fn_calls.append(fc)
                        model_parts.append(types.Part(function_call=fc))
                        yield {"type": "tool_call", "name": fc.name}
        except Exception as e:  # noqa: BLE001
            yield {"type": "error", "message": f"Error durante streaming: {e}"}
            return

        if not fn_calls:
            yield {"type": "end"}
            return

        # Agregar el turno del modelo con function_calls + dispatchar tools
        if model_parts:
            contents.append(types.Content(role="model", parts=model_parts))

        tool_parts: List[types.Part] = []
        for fc in fn_calls:
            args = dict(fc.args) if fc.args else {}
            result = dispatch_tool(fc.name, args, db, current_user)
            yield {"type": "tool_result", "name": fc.name}
            tool_parts.append(types.Part.from_function_response(name=fc.name, response=result))
        contents.append(types.Content(role="user", parts=tool_parts))

    yield {"type": "error", "message": "Límite de iteraciones alcanzado."}
    yield {"type": "end"}


