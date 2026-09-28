# Pinch product surface

Pinch intentionally ships only the product surfaces listed here. A page or product API not listed here must not be mounted in production.

## Pages

- `/`
- `/login`
- `/register`
- `/dashboard`
- `/planner`
- `/account`

## Product capabilities

- Firebase authentication and session management
- Dashboard, customers, and general plans
- Plan generation, editing, saving, deletion, and PDF export
- Account password, session, and deletion controls

Folders/Explorer, standalone customer pages, plan duplication, Ramadan mode, custom-food creation, and non-standard diet modes are retired product features.

Operational and security endpoints are documented separately in `docs/api-surface.md`; lack of a visible UI control does not make those endpoints dead code.
