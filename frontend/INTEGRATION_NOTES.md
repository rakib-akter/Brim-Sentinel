# Brim Sentinel frontend integration

The TanStack Start frontend uses the FastAPI OpenAPI contract and the synthetic Harborline Logistics dataset. The API defaults to `http://localhost:8000`. Set `VITE_SENTINEL_API_URL` before starting or building the frontend when the backend uses another origin. FastAPI's `FRONTEND_ORIGIN` must include the browser's frontend origin. Seed the backend first using its README.

From this directory:

```sh
bun install --frozen-lockfile
bun run dev
bun run tsc --noEmit
bun run test
bun run build
BRIM_TEST_PYTHON=/absolute/path/to/backend/.venv/bin/python bun tests/backend-integration.mjs
```

The integration test imports the built SSR worker, seeds a temporary SQLite database and sends HTTP requests through FastAPI's in-process test client. It checks role-scoped rendering and takes the synthetic Cascadia invoice through a denied callback attempt, fixture-backed verification, independent route authorization, approval, simulated settlement and audit export. It runs with AI disabled and uses no listening ports.

The session starts as AP clerk Jordan Okafor (U004) unless a demo identity was selected previously. The identity cookie is a demo selector. Backend permissions and per-record actions drive workflows. Identity changes reload the page so SSR, client state and the selected identity agree.
