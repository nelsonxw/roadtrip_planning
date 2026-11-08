# RoadTrip AI

A map-first road trip planner. Enter a start and destination, add stops, find places along the route, and review a day-by-day itinerary. The assistant proposes changes and shows their driving impact. Nothing changes until you accept.

The full product specification is in [`requirement.md`](./requirement.md).

## Status

MVP in progress. See the [requirements checklist](#requirements-checklist) for what is complete, partial, and deferred.

## Quick start (Windows, macOS, Linux)

Requirements: Node.js 20+ (tested on 24) and npm.

```bash
npm install
cp .env.example .env.local          # Windows PowerShell: Copy-Item .env.example .env.local
npm run db:dev                      # starts a local PostgreSQL on port 5433 (keep this running)
npm run db:migrate                  # applies migrations to DATABASE_URL
npm run dev                         # http://localhost:3000
```

Open http://localhost:3000, create an account, and create a trip.

With no API keys set, routing and geocoding use a **demo provider** and are labelled "DEMO". Places and photos still come from live public sources (OpenStreetMap, Wikipedia, Wikimedia Commons).

## Environment variables

All variables are read on the server. Only `NEXT_PUBLIC_MAP_STYLE_URL` is exposed to the browser, and it is not a secret.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `OPENROUTESERVICE_API_KEY` | no | Enables live geocoding, autocomplete, and driving routes. Without it, demo providers are used. |
| `GEOAPIFY_API_KEY` | no | Places along the route from Geoapify (free plan). Without it, the Overpass fallback is used. |
| `OVERPASS_URL` | no | OpenStreetMap Overpass endpoint for the fallback. Defaults to the public instance. |
| `WIKIMEDIA_USER_AGENT` | recommended | Identifying User-Agent with a contact address, required by Wikimedia policy. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | no | Reserved for the language-model assistant. Not yet wired up; see limitations. |
| `NEXT_PUBLIC_MAP_STYLE_URL` | no | MapLibre style. Defaults to a keyless OpenFreeMap style. |
| `SESSION_TTL_DAYS` | no | Session lifetime, default 30. |

## Provider configuration

- **OpenRouteService (routing, geocoding):** create a free key at https://openrouteservice.org/dev/#/signup and set `OPENROUTESERVICE_API_KEY`. Free-tier quotas apply (check the current limits on the provider's dashboard; they change). Each leg is a separate two-point request, so waypoint limits never apply, and legs are cached in the `RouteCache` table.
- **Geoapify (places, primary):** create a free key at https://myprojects.geoapify.com and set `GEOAPIFY_API_KEY`. The free plan is 3,000 credits a day (one credit per 20 places returned) and allows commercial use. Attribution is required and shown in the app and PDF: "© OpenStreetMap contributors" and "Powered by Geoapify". Each search is one request for the whole route. Geoapify returns no descriptions or photos, so those stay empty.
- **OpenStreetMap Overpass (places, fallback):** used only when no Geoapify key is set. Public servers have fair-use limits and were unreliable from one network during development (HTTP 406, 504s, long responses). Set `OVERPASS_URL` to a reliable instance if you rely on it.
- **Wikipedia and Wikimedia Commons (descriptions, photos):** no key. Photos are shown only when Commons metadata provides a licence; otherwise a neutral placeholder is shown.
- **Anthropic (assistant):** not connected yet. The assistant runs in demo mode and is labelled as such.

## Architecture

```
src/
  domain/        Pure logic: stop operations, itinerary building, geo helpers (unit-tested, no I/O)
  services/      Provider interfaces (types.ts) and adapters: OpenRouteService, Overpass, Wikimedia, demo
  server/        Trip service (persistence, version checks, route sync), proposals, assistant, exporters, auth
  app/api/       Route handlers. Every handler requires a session and checks trip ownership.
  components/    React UI: map (MapLibre), itinerary, places, chat, trip creation
prisma/          Schema and migrations
tests/           Unit tests, service adapter tests, and database integration tests
scripts/         Local database launcher and an end-to-end API smoke test
```

Key decisions:

- **One authoritative trip state.** Map, itinerary, chat, and exports all read the same server-side trip view.
- **Typed operations only.** Every change (manual or assistant) is a validated operation: `add_stop`, `remove_stop`, `move_stop`, `update_stop`, `optimize_order`, `set_preferences`. The assistant cannot write to the database directly.
- **Proposals.** The assistant stores a proposal with the operations and a simulated impact (real provider times). The user accepts or rejects. Acceptance re-checks the trip version, so a stale proposal cannot apply.
- **Optimistic concurrency.** Each write sends the version it was based on. The server increments the version in a single conditional update. Stale writes get HTTP 409, and the client reloads the trip. Inputs are not cleared on failure.
- **Failures keep edits.** If a route cannot be calculated, the stop is still saved, the leg is marked "not calculated", and the error is shown.
- **Undo.** Each change writes a revision snapshot. Undo restores the previous snapshot as a new revision.
- **Itinerary is derived.** Day plans are computed from the ordered stops and cached legs on every read, so they cannot drift from the map.
- **Sessions and passwords.** Passwords use scrypt. Session tokens are random and stored only as SHA-256 hashes.

## Tests

```bash
npm test              # unit, adapter, import, and database integration tests (needs the local database running)
npm run typecheck
npx eslint src tests scripts e2e playwright.config.ts
npm run test:e2e      # Playwright browser tests: builds the app, serves it on port 3100, runs headless Chromium
node scripts/smoke-api.mjs http://localhost:3000   # API smoke test against a running server
```

First time only, install the browser: `npx playwright install chromium`.

Last recorded run:
- **68 Vitest tests passing** (including the Geoapify adapter: request shape, key placement, mapping, and error handling): domain logic, provider adapters, stop-list import parsing and validation (including a real XLSX file), the Gemini assistant planner (scripted model replies, coordinate guard, validation, rate-limit fallback), and database integration covering ownership, version conflicts, required-stop confirmation, undo, provider failure, proposal acceptance, and import ordering. Tests never call live APIs.
- **7 Playwright tests passing:** sign-up, trip creation with autocomplete, add-and-remove through a confirmed proposal, itinerary-to-marker highlighting, CSV import with invalid rows, export downloads, cross-user access, and the signed-out redirect.
- **18 API smoke checks passing.**
- TypeScript, ESLint, and `next build` pass.

## Deployment

1. Provision PostgreSQL 15+ (managed services such as Neon, Supabase, or RDS work).
2. Set `DATABASE_URL` and the optional keys in the host's environment.
3. `npm ci && npm run db:migrate && npm run build && npm start`. Any Node 20+ host works. A Docker image is not included yet.
4. Serve over HTTPS. Session cookies are `Secure` in production.

## Known limitations

- **Assistant is rule-based.** It understands a few commands: add a place, remove a stop, reduce daily driving, and optimize order. It does not yet use a language model. The Anthropic adapter is not implemented.
- **No scenic routing.** The routing provider supports fastest or shortest routes and avoiding tolls, highways, and ferries. Scenic routing is not offered; scenic detours would be POI-based instead.
- **Detour distances are straight-line** from the place to the nearest route point, not driving detours. They are labelled that way.
- **Visit lengths are category estimates** and are labelled as estimates. Opening hours are never shown because they are not verified.
- **Stop ordering optimization** uses nearest-neighbour, a fast heuristic, not an optimal solver.
- **Undo** restores only the most recent change, one step at a time.
- **PDF** has no embedded photos, to keep exports fast and avoid fetching third-party images at export time. Source links and attributions are included.
- **Accounts** are email and password only. There is no email verification or password reset yet.
- **Place search is unverified against the live Geoapify API.** The adapter is unit-tested against mocked responses. Live verification needs a `GEOAPIFY_API_KEY`.
- **Browser tests cover the main workflows in headless Chromium only.** Drag-and-drop is not offered (move buttons are used instead). Map rendering depends on WebGL and the style server; when WebGL is missing, the page shows a message and the itinerary still works. Tiles are not asserted in tests.
- **Stop-list import:** the file's `sequence` column is ignored (file order is always kept). Address lookups are capped at 100 per import, and files are limited to 500 rows and 2 MB. In demo geocoding only a few sample cities resolve, so import with coordinates or a live key for real addresses.
- **Local database:** on this machine, Docker and the PostgreSQL installer were unavailable, so development uses the `embedded-postgres` package (PostgreSQL 18). Production should use a managed PostgreSQL.
- Next.js Cache Components are disabled (`cacheComponents: false`) because every page depends on the session cookie.

## Requirements checklist

**Complete**
- Origin and destination with autocomplete and explicit selection (no silent guessing).
- Manual stop add, remove, reorder, edit (notes, visit length, required/optional), with stable IDs.
- Driving route on the map with per-leg distance and time; legs recalculated only when affected.
- Places along the route (OSM), with Wikipedia descriptions, licensed photos, source links, and category estimates. Built and unit-tested; live place search needs a reliable Overpass instance (see provider notes).
- Clustered places, marker shapes distinct from colour, click-to-highlight in both directions.
- Day-by-day itinerary with drive totals, overnight stops, rest days, and warnings for unrealistic duration or packed days.
- Required-stop removal requires explicit confirmation (UI and server).
- AI-style proposals with impact, accept and reject, and stale-proposal protection.
- Save, reopen, delete, and undo.
- Accounts with ownership checks on every route; anonymous and cross-user access refused.
- CSV export and PDF export built from the latest saved state, with a generated timestamp.
- Provider failures reported with actionable messages; user edits preserved.
- Secrets kept on the server; no keys in browser code.
- CSV and XLSX stop-list import: upload with a size and row limit, column mapping with suggestions, per-row validation, ambiguous-location choice, skipped invalid rows, file order preserved, applied as one atomic change.
- Downloadable CSV template.
- CSV export guards against spreadsheet formula injection.
- Playwright browser tests for the main workflows.

**Partial**
- Assistant: proposals and confirmation work, but understanding is rule-based, not a language model.
- Accessibility: keyboard move controls, labelled buttons, and focus styles are in place, but there has been no screen-reader or full keyboard audit.
- Mobile layout: tabbed layout implemented, not tested on devices.
- Map layers and legend: legend included; no style switcher.
- Trip editing: name and days are editable through the API; the UI shows them read-only.

**Deferred (per spec or not started)**
- Using the file's sequence column as a preferred order (ignored for now).
- XLSX export and JSON backup (Phase 2).
- Alternate route comparison, scenic routing, live traffic and weather (Phase 2/3).
- Language-model assistant via the Anthropic adapter.
- Restaurant and accommodation discovery, user photo uploads, sharing, calendar and booking integrations.
