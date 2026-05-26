"""
Router del módulo Koski IA.

Endpoints:
  POST /api/chat           → respuesta no-streaming (JSON). Útil para Swagger/debug.
  POST /api/chat/stream    → respuesta streaming via SSE.
"""
import json
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from database import get_db
from auth import get_current_user
from models.planning import Usuario
from schemas.koski_ia import ChatRequest, ChatResponse
from services.koski_ia_service import run_chat, stream_chat

logger = logging.getLogger("koski_ia")

router = APIRouter(prefix="/api/chat", tags=["koski-ia"])


@router.post("", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Respuesta completa (no-streaming). Útil para pruebas en Swagger."""
    result = run_chat(body.messages, db, current_user, mode=body.mode or "fast")
    return ChatResponse(text=result["text"], tool_calls=result["tool_calls"])


@router.post("/stream")
async def chat_stream(
    body: ChatRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Respuesta streaming vía Server-Sent Events.

    Yieldea dicts {"data": "<json string>"} — sse-starlette se encarga de formatear
    como `data: ...\\n\\n`. Si yieldeáramos el string ya envuelto, se duplicaría el prefijo.
    """

    async def event_generator():
        try:
            async for event in stream_chat(body.messages, db, current_user, mode=body.mode or "fast"):
                yield {"data": json.dumps(event, ensure_ascii=False)}
        except Exception as e:  # noqa: BLE001
            logger.exception("Error en chat_stream")
            yield {"data": json.dumps({"type": "error", "message": str(e)})}

    return EventSourceResponse(event_generator())
