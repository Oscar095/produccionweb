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
- **Entry point:** `backend/main.py` — registers routers, creates `planeacion.*` tables on startup, and runs idempotent seeds (column migrations on `rutas_siesa`, default permissions for new modules like `koski_ia`).
- **Database:** `backend/database.py` — parses ADO.NET `CONN_STRING_SQL` env var, builds SQLAlchemy URL for Azure SQL with `pyodbc` + ODBC Driver 18. Exports `engine`, `SessionLocal`, `get_db` and `Base`.
- **Auth:** `backend/auth.py` — JWT (HS256, 8h expiry), bcrypt password hashing, `get_current_user` dependency, `require_roles()` factory. JWT `SECRET_KEY` must be changed in production.
- **Models:**
  - `backend/models/planning.py` — writable tables (`planeacion.*`): `Usuario`, `Rol`, `RolPermiso`, `Asignacion`, `ParadaProgramada`, `ResumenSemanal`, `RutaSiesa`, `KanbanPrioridad`.
  - `backend/models/production.py` — read-only `dbo.*`: `CentroCostos`, `Maquina`, `OpNumero`, `RegistroProduccion`, `PersonalPlanta`.
  - `backend/models/maintenance.py` — read-only `dbo.*` for maintenance.
- **Schemas:** `backend/schemas/` — Pydantic v2 models per module (`auth`, `gantt`, `production`, `planning`, `maintenance`, `reports`, `roles`, `config`, `koski_ia`).
- **Routers** (one file per module under `backend/routers/`):
  - `auth.py` — login, user CRUD, password reset (`/api/auth`).
  - `gantt.py` — `/api/gantt` Gantt data assembly.
  - `production.py` — `/api/production` orders, KPIs, machines, operators, production records.
  - `planning.py` — `/api/planning` board, kanban, asignaciones, paradas, capacidad, feasibility, timeline, kanban prioridades, integration with Siesa external API for closing OPs.
  - `maintenance.py` — `/api/maintenance` maintenance tickets.
  - `reports.py` — `/api/reports` weekly summaries (PDF via reportlab) and production reports.
  - `roles.py` — `/api/roles` dynamic role/permission CRUD. The `MODULOS` constant lists every UI module that can be permissioned.
  - `config.py` — `/api/config` machines / centros de costo / rutas SIESA admin.
  - `koski_ia.py` — `/api/chat` and `/api/chat/stream` (SSE) for the AI chat assistant.
- **Services** (`backend/services/`) — business logic:
  - `gantt_service.py` — assembles tasks (asignaciones + paradas + tickets) for Gantt.
  - `planning_engine.py` — capacity and feasibility calculations.
  - `report_service.py` — weekly summary + PDF generation (reportlab).
  - `working_hours.py` — operative-hour math; plant runs 24h Mon–Fri, weekends excluded.
  - `koski_ia_service.py` — Anthropic Claude agentic loop (anthropic SDK) with hybrid model (Haiku fast / Sonnet deep) and the `gerente-procesos` skill embedded in a cacheable system block.
  - `koski_ia_tools.py` — tool implementations + `ANTHROPIC_TOOLS` exposed to Claude (input_schema format).

### Frontend — React 18 + TypeScript + Vite
- **State:** `frontend/src/store/auth.ts` — Zustand store. JWT and `permisos` map (`{[modulo]: {ver, crear, editar, eliminar}}`) live in `localStorage` (`kos_token`, `kos_user`).
- **API clients:** `frontend/src/api/` — axios per module via `client.ts` base. The chat module uses native `fetch` + `ReadableStream` for SSE (`koski_ia.ts`); axios doesn't support streaming response bodies.
- **Pages** (`frontend/src/pages/`): `Login`, `Dashboard`, `Gantt`, `Planning`, `Orders`, `Maintenance`, `Reports`, `Usuarios`, `Configuracion`, `Chat`.
- **Layout:** `frontend/src/components/Layout.tsx` — sidebar nav with `NAV` array; each entry has `modulo` key matching a permission key. Items are filtered by `user.permisos[modulo].ver`.
- **Data fetching:** TanStack React Query for axios calls. Chat uses `useState` + `fetch` directly (streaming).
- **UI:** Tailwind CSS + lucide-react icons + Recharts (charts) + @dnd-kit (drag & drop in Planning board) + custom SVG Gantt.

### Key Architectural Constraints
- `dbo.*` tables are **read-only** — AppSheet continues to operate on them.
- All new data lives in `planeacion.*` schema.
- Backend auto-creates `planeacion.*` tables on startup (`checkfirst=True`) — safe to restart.
- Idempotent startup migrations live in `main.py`'s `startup` handler (column adds, permission seeds for new modules). Adding a new permissionable module requires (a) adding it to `MODULOS` in `routers/roles.py`, (b) seeding `puede_ver=True` for existing roles in `main.py`'s startup, (c) adding the entry to the frontend `NAV` with the same `modulo` string.
- Azure SQL connections use `pool_pre_ping=True` and `pool_recycle=1800` to handle Azure idle connection drops.

### Roles & Permissions
Roles are **dynamic** (rows in `planeacion.roles`) with per-module permissions in `planeacion.rol_permisos`. The conventional set is:

| Rol | Acceso típico |
|-----|---------------|
| `Administrador` | Todo, incluido gestión de usuarios y roles |
| `Supervisor` | Asigna OPs, registra paradas, genera reportes |
| `Operador` | Lectura (dashboard, gantt, órdenes, mantenimiento) |

Backend enforcement: `Depends(require_roles("Administrador", "Supervisor"))` on each route. Frontend uses `usePermiso(modulo)` from `store/auth.ts` to gate UI elements.

The `MODULOS` list in `backend/routers/roles.py` is the source of truth for what modules can be permissioned. Current set: `dashboard`, `ordenes`, `gantt`, `planeacion`, `mantenimiento`, `reportes`, `usuarios`, `configuracion`, `koski_ia`.

## Modules

### Koski IA (AI chat assistant)
- **Stack:** Anthropic Claude via the official `anthropic` Python SDK, integrated directly into the FastAPI backend (no n8n, no separate orchestrator). Hybrid model selection per request: `mode="fast"` → Claude Haiku 4.5 (operational chat), `mode="deep"` → Claude Sonnet 4.6 (deep analysis with the `gerente-procesos` skill).
- **Tools** are plain Python functions in `services/koski_ia_tools.py` that receive the request's SQLAlchemy `Session` and reuse existing services (`gantt_service`, `planning_engine`, `report_service`) plus direct queries on `models.production` / `models.planning`. v1 is read-only. Analytical tools: `get_oee_breakdown`, `get_paradas_pareto`, `get_kpi_series`, `get_descriptiva`.
- **System prompt** is built in `services/koski_ia_service.py::_build_system_blocks()` as two blocks: (1) a cacheable block with `BASE_RULES` + the full `gerente-procesos` SKILL.md (loaded once at first request from `~/.claude/skills/gerente-procesos/SKILL.md` or `backend/skills/gerente-procesos/SKILL.md` as fallback); (2) a dynamic block with today's date, current user, and mode. The cacheable block uses Anthropic's `cache_control: {type: "ephemeral"}` so subsequent turns hit the cache.
- **Streaming** uses `sse-starlette`'s `EventSourceResponse`. The generator must yield `{"data": "<json>"}` dicts — sse-starlette wraps them in `data: ...\r\n\r\n` automatically. Internally the service consumes Anthropic's `client.messages.stream()` and re-emits events as the existing shape (`text`, `tool_call`, `tool_result`, `end`, `error`) so the frontend parser is unchanged.
- **Frontend SSE client** (`frontend/src/api/koski_ia.ts`) uses `fetch` + `ReadableStream` (not `EventSource`, which doesn't allow `Authorization` headers). The parser tolerates `\r\n\r\n`, `\n\n`, and `\r\r` separators. The client passes `mode` in the POST body; `Chat.tsx` exposes a Rápido/Análisis toggle.
- **Adding a tool** (3 steps in `services/koski_ia_tools.py`): write `tool_xxx(db, ...)` → register in `TOOLS` dict → add an entry to `ANTHROPIC_TOOLS` (Anthropic uses `input_schema`, not `parameters`; the description is what makes Claude decide to invoke it).

### Planning board (Kanban)
- `KanbanPrioridad` table holds manual ordering per (machine, OP). Endpoints in `routers/planning.py`: `/board`, `/kanban`, `/kanban/prioridades`, `/asignaciones`, `/prioridades`, `/paradas`, `/feasibility`, `/timeline`.
- `services/planning_engine.py` calculates weekly capacity (`get_capacidad_semana`) and feasibility (`get_feasibility`).
- `services/working_hours.py` provides operative-hour math (Mon–Fri, weekends excluded).

## Environment

`.env` in project root (not committed):
```
CONN_STRING_SQL=Data Source=myappskos.database.windows.net;Initial Catalog=kos_apps;User ID=...;Password=...
ANTHROPIC_API_KEY=<sk-ant-... required for Koski IA>
KOSKI_IA_MODEL_FAST=claude-haiku-4-5-20251001   # optional, default Haiku 4.5
KOSKI_IA_MODEL_DEEP=claude-sonnet-4-6           # optional, default Sonnet 4.6
API_CERRAR_OPS=<URL>               # Siesa external API for closing OPs (planning router)
ConniKey=...
ConniToken=...
```

Frontend env files:
- `frontend/.env.development` → `VITE_API_URL=http://localhost:8000` — required so the dev frontend hits the backend directly. The Vite proxy (`/api` → `:8000`) buffers SSE responses and breaks the chat stream; routing chat traffic past the proxy avoids that.
- `frontend/.env.production` → `VITE_API_URL=` (empty; same-origin in production behind the SPA mount).

## Deployment

Deployed on Azure App Service. The `backend/Dockerfile` is the deployment artifact. The `sys.path.insert` at the top of `main.py` exists for Azure Oryx build compatibility. The backend serves the built frontend from `backend/static/` (mounted at `/`) when present — see `serve_spa` in `main.py`.
