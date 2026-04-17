"""
KOS Xpress — Sistema de Planeación de Producción
FastAPI backend — Python 3.11
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from models import *   # registra todos los modelos con Base

# Importar modelos de planeacion para crear tablas si no existen
from models.planning import Usuario, Asignacion, ParadaProgramada, ResumenSemanal, Rol, RolPermiso

from routers import auth, gantt, production, maintenance, planning, reports, roles

app = FastAPI(
    title="KOS Xpress — Planeación de Producción",
    description="API para el sistema MES de KOS Xpress. Reemplaza AppSheet con análisis y planeación.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — ajustar en producción con los dominios reales
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registrar routers
app.include_router(auth.router)
app.include_router(gantt.router)
app.include_router(production.router)
app.include_router(maintenance.router)
app.include_router(planning.router)
app.include_router(reports.router)
app.include_router(roles.router)


@app.on_event("startup")
def startup():
    """Crear tablas del esquema planeacion.* si no existen."""
    # Solo crea tablas nuevas — no toca las existentes de dbo.*
    from sqlalchemy import text
    with engine.connect() as conn:
        # Crear esquema planeacion si no existe
        conn.execute(text("IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'planeacion') EXEC('CREATE SCHEMA planeacion')"))
        conn.commit()
    Base.metadata.create_all(
        bind=engine,
        tables=[
            Usuario.__table__,
            Asignacion.__table__,
            ParadaProgramada.__table__,
            ResumenSemanal.__table__,
        ],
        checkfirst=True,
    )


@app.get("/", tags=["health"])
def health():
    return {"status": "ok", "app": "KOS Xpress", "version": "1.0.0"}
