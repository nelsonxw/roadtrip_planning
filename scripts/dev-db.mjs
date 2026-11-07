// Starts a local PostgreSQL server for development (no Docker required).
// Data lives in ./.pgdata and is git-ignored. Keep this process running while developing.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const databaseDir = "./.pgdata";
const pg = new EmbeddedPostgres({ databaseDir, user: "postgres", password: "postgres", port, persistent: true });

if (!existsSync(`${databaseDir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("roadtrip");
} catch {
  // Database already exists from a previous run.
}
console.log(`PostgreSQL ready on port ${port}. DATABASE_URL=postgresql://postgres:postgres@localhost:${port}/roadtrip`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
