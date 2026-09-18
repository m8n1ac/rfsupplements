// Integration tests run against rfs_crm_test, never the live database.
//
// The URL is derived from the real DATABASE_URL by swapping only the database
// name, so this file holds no credential and follows the real one if it is
// rotated. It must run before any module reads the environment, because
// src/lib/env.ts validates at import and src/lib/db.ts builds its pool from it.
const live = process.env.DATABASE_URL;

if (!live) {
  throw new Error("DATABASE_URL is not set — is dotenv/config loaded first?");
}

const testUrl = live.replace(/\/[^/?]+(\?.*)?$/, "/rfs_crm_test$1");

if (testUrl === live || !testUrl.includes("rfs_crm_test")) {
  throw new Error(`Could not derive a test database URL from DATABASE_URL`);
}

process.env.DATABASE_URL = testUrl;
