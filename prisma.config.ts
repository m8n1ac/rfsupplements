import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 7 does not load .env automatically, and the connection URL now lives
// here rather than in schema.prisma. The runtime client connects through the
// MariaDB driver adapter in src/lib/db.ts; this block is for migrate/introspect.
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
});
