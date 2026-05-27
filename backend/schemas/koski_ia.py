"""Schemas para el módulo Koski IA (chat asistente)."""
from typing import List, Literal, Optional
from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["user", "model"]
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    mode: Optional[Literal["fast", "deep"]] = "fast"


class ChatResponse(BaseModel):
    text: str
    tool_calls: List[str] = []
