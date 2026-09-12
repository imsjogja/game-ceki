# AGENTS.md — RemiKu / Game Ceki

## Project overview

RemiKu is an online Indonesian rummy (ceki) game. It supports authenticated or
guest players, multiplayer rooms, bot opponents, persisted match statistics,
and WebRTC voice chat.

The project is a TypeScript monorepo:

- **Frontend:** React 19, React Router 7, Vite, Tailwind CSS, shadcn/ui, and
  TanStack React Query.
- **Backend:** Hono and tRPC, served by Vite in development and bundled with
  esbuild for production.
- **Database:** MySQL with Drizzle ORM.
- **Shared domain layer:** game rules, state, and API-adjacent contracts under
  `contracts/`.

Use Node.js 20 or later.

## Repository layout

```text
src/                     React application
  pages/                 Route-level UI: Home, Login, Room, NotFound
  components/game/       Game table, lobby, cards, voice controls, modals
  components/ui/         Generated shadcn/ui primitives; avoid broad rewrites
  hooks/                 Auth and WebRTC voice-chat client logic
  providers/trpc.tsx     tRPC + React Query client setup
  lib/                   Browser utilities and sounds

api/                     Hono/tRPC backend
  boot.ts                HTTP entry point and production server bootstrap
  router.ts              Root tRPC router
  *-router.ts            Feature routers
  queries/               Drizzle database access and schema bootstrap
  auth/                  Google OAuth and application-session integration
  presence.ts            In-memory live-room presence

contracts/               Shared client/server contracts and game engine
  rummy.ts               Authoritative rummy rules and GameState mutations
  voice.ts               Voice signaling contracts/constants

db/schema.ts             Drizzle table definitions
db/migrations/           Generated Drizzle migrations
```

## Commands

```bash
npm install
cp .env.example .env     # Fill required secrets locally; never commit this file

npm run dev              # Vite + Hono development server on port 3000
npm run check            # Type-check frontend, API, contracts, and DB
npm run lint             # ESLint
npm test                 # Vitest API tests
npm run build            # Build client and production API entry point
npm run format           # Format all supported files

npm run db:generate      # Create migration after db/schema.ts changes
npm run db:migrate       # Apply migrations
npm run db:push          # Direct schema push; use deliberately

docker compose up --build -d    # Run the app + local MySQL in Docker
docker compose logs -f app      # Follow application logs
docker compose down             # Stop services; preserves MySQL volume
```

`DATABASE_URL` is required for all Drizzle commands. The production bootstrap
also calls `api/queries/ensure-schema.ts`; keep its idempotent SQL aligned with
`db/schema.ts` when adding or changing tables.

For Docker, copy `.env.docker.example` to `.env` and replace local passwords
before exposing the service outside your machine. `compose.yaml` includes
local-only fallbacks so the guest-play flow can boot without a `.env` file.

## Implementation rules

1. **Keep game rules shared and authoritative.** Put card validation, scoring,
   turn flow, bot behavior, and `GameState` changes in `contracts/rummy.ts`.
   UI code must not independently reimplement server-authoritative rules.
2. **Preserve room concurrency protection.** Mutations of persisted game state
   must use `withRoom()` from `api/queries/rooms.ts`, which performs optimistic
   locking through the room `version` column.
3. **Validate all tRPC inputs with Zod.** Use `authedQuery` for player actions,
   reserve `publicQuery` only for truly public endpoints, and perform
   host/ownership checks on the server.
4. **Do not expose private player state.** Return game state through
   `sanitizeState()` for room reads so one player cannot see other hands.
5. **Treat in-memory features as per-process.** `api/presence.ts` and
   `api/voice-router.ts` are intentionally ephemeral and do not work as shared
   state across multiple server instances. Do not persist WebRTC SDP/ICE
   messages to MySQL.
6. **Keep database changes complete.** For schema changes, update
   `db/schema.ts`, generate/commit the migration, and update
   `ensure-schema.ts` if production bootstrap must support a fresh database.
7. **Use path aliases consistently.** `@/` maps to `src/`, `@contracts/` to
   `contracts/`, and `@db/` to `db/`.
8. **Follow existing UI conventions.** The visual style is the dark felt,
   gold, and red card-table theme. Prefer existing Tailwind tokens/classes and
   local game components. Do not replace generated `src/components/ui/`
   primitives unless the change requires it.
9. **Do not hardcode or commit credentials.** Keep `.env`, database URLs,
   OAuth secrets, session signing secrets, and user data out of source, logs,
   tests, and documentation.

## Verification expectations

- Run `npm run check` and `npm run lint` for TypeScript or UI/backend changes.
- Run `npm test` after changing presence logic, routers, or shared game logic.
- Add focused Vitest coverage under `api/**/*.test.ts` for new server/domain
  behavior, especially scoring, authorization, state transitions, and
  concurrency-sensitive room mutations.
- Run `npm run build` before handing off broad cross-stack changes.

## Notes

- The root `README.md` is still the Vite starter README; rely on this guide and
  source code for the application architecture until the README is expanded.
- Do not delete room, match, or player-stat records as part of routine work.
