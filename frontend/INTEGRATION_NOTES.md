# Brim Sentinel frontend integration

Frontend source: `rakib-akter/harborline-invoice-pilot`.
Mascot images: `rakib-akter/remix-of-pixel-perfect-replica`.

The original Lovable repositories were not changed. Lovable-specific `.lovable/` and `AGENTS.md` were intentionally excluded because this independent copy uses Codex for frontend development and FastAPI for backend services.

Run from `frontend/`: `bun install && bun run dev` (or `npm install && npm run dev`).

Next: implement invoice resolution wizard, relationship graph, Flight Recorder and integrate FastAPI through the existing API contract. All financial decisions and permissions must be enforced by the backend, never by frontend mock rules.
