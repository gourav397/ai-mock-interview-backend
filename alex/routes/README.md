# ALEX Multi-Agent System — Routes

## Dashboard API Endpoints

All endpoints are mounted at `/api/alex/*` and require authentication
(via `x-admin-key` header with `ADMIN_KEY` from `.env`, or a valid JWT token).

### System Status

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alex/status` | Full system status with agent health |
| GET | `/api/alex/health` | Current health check results |
| POST | `/api/alex/health/check` | Force immediate health check |

### Incidents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alex/incidents` | List incidents (filterable) |
| GET | `/api/alex/incidents/:id` | Single incident detail + audit log |
| POST | `/api/alex/incidents` | Manually create an incident |
| PATCH | `/api/alex/incidents/:id` | Update incident status/resolution |
| POST | `/api/alex/incidents/:id/escalate` | Force escalate to next agent |

### Audit & Backups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alex/audit` | Recent audit events |
| GET | `/api/alex/backups` | List available backups/snapshots |
| POST | `/api/alex/backups` | Create a manual backup snapshot |
| POST | `/api/alex/backups/restore` | Restore a file from backup |

### Controls

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/alex/reset/circuit-breaker` | Reset security agent circuit breaker |
| POST | `/api/alex/analyze` | AI-powered issue analysis |