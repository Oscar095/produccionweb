"""
KOS Xpress — Sistema de Planeación de Producción
FastAPI backend — Python 3.11
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "app": "KOS Xpress", "version": "1.0.0"}


# Servir frontend estático (solo si existe el build)
_static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if os.path.isdir(_static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(_static_dir, "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str = ""):
        # Servir archivos estáticos que existen (favicon, robots.txt, etc.)
        candidate = os.path.join(_static_dir, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        # Todo lo demás → index.html (React Router se encarga del routing)
        return FileResponse(os.path.join(_static_dir, "index.html"))
