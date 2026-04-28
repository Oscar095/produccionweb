# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**KOS Colombia** — MES (Manufacturing Execution System) that replaces AppSheet for industrial production planning. Connects to an existing Azure SQL Server database (`kos_apps`) without modifying its `dbo.*` tables. Only writes to the `planeacion.*` schema.

## Commands

### Backend (from `/backend`)
```bash
uvicorn main:app --reload --port 8000
# Swagger UI: http://localhost:8000/docs
```

### Frontend (from `/frontend`)
```bash
npm run dev        # Dev server: http://localhost:5173
npm run build      # tsc -b && vite build
npm run lint       # ESLint
npm run preview    # Preview production build
```

### Docker (full stack)
```bash
docker-compose up --build
# Backend: http://localhost:8000 | Frontend: http://localhost:3000
```

### Database migration (optional, runs automatically on startup)
```bash
sqlcmd -S myappskos.database.windows.net -U kos -P "password" \
       -d kos_apps -i migrations/001_create_planeacion_schema.sql
```

## Architecture

### Backend — FastAPI + SQLAlchemy 2.0
- **Entry point:** `backend/main.py` — registers routers, creates `planeacion.*` tables on startup
- **Database:** `backend/database.py` — parses ADO.NET `CONN_STRING_SQL` env var, builds SQLAlchemy URL for Azure SQL with `pyodbc` + ODBC Driver 18
- **Auth:** `backend/auth.py` — JWT (HS256, 8h expiry), bcrypt password hashing, `require_roles()` dependency factory
- **Models:** `backend/models/planning.py` — all writable tables (`planeacion.*`): `Usuario`, `Asignacion`, `ParadaProgramada`, `ResumenSemanal`, `Rol`, `RolPermiso`. Read-only `dbo.*` tables are in `backend/models/production.py` and `backend/models/maintenance.py`
- **Schemas:** `backend/schemas/` — Pydantic v2 models
- **Routers:** one file per module: `auth`, `gantt`, `production`, `maintenance`, `planning`, `reports`, `roles`
- **Services:** `backend/services/` — business logic: `gantt_service.py`, `planning_engine.py`, `report_service.py` (PDF via reportlab)

### Frontend — React 18 + TypeScript + Vite
- **State:** `frontend/src/store/auth.ts` — Zustand store for auth/JWT
- **API clients:** `frontend/src/api/` — axios clients per module (`client.ts` base, then `gantt.ts`, `planning.ts`, `production.ts`, etc.)
- **Pages:** `frontend/src/pages/` — `Dashboard`, `Gantt`, `Planning`, `Orders`, `Maintenance`, `Reports`, `Usuarios`, `Login`
- **Layout:** `frontend/src/components/Layout.tsx`
- **Data fetching:** TanStack React Query
- **UI:** Tailwind CSS + lucide-react icons + Recharts (charts) + @dnd-kit (drag & drop in Planning board) + custom SVG Gantt

### Key Architectural Constraints
- `dbo.*` tables are **read-only** — AppSheet continues to operate on them
- All new data lives in `planeacion.*` schema
- Backend auto-creates `planeacion.*` tables on startup (`checkfirst=True`) — safe to restart
- Azure SQL connections use `pool_pre_ping=True` and `pool_recycle=1800` to handle Azure idle connection drops
- JWT `SECRET_KEY` in `backend/auth.py` must be changed in production

### Roles
| Role | Access |
|------|--------|
| `admin` | Full access including user management |
| `supervisor` | Assign orders, pause machines, generate reports |
| `operador` | Read-only (dashboard, gantt, orders, maintenance) |

Role enforcement is done via `require_roles()` dependency in FastAPI routers.

## Environment

`.env` in project root (not committed):
```
CONN_STRING_SQL=Data Source=myappskos.database.windows.net;Initial Catalog=kos_apps;User ID=...;Password=...
```

Frontend API URL: `frontend/.env` → `VITE_API_URL=http://localhost:8000`

## Deployment

Deployed on Azure App Service. The `backend/Dockerfile` is the deployment artifact. The `sys.path.insert` at the top of `main.py` exists for Azure Oryx build compatibility.
