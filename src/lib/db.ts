// The database client never belongs in a client bundle.
import "server-only";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

// Prisma 7 connects through a driver adapter. One pool per process; in dev the
// module is re-evaluated on every hot reload, so the client is cached on
// globalThis to avoid exhausting MariaDB connections.

const createClient = () =>
  new PrismaClient({ adapter: new PrismaMariaDb(env.DATABASE_URL) });

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
