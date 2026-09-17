import { hash, verify } from "@node-rs/argon2";

// Passwords are argon2id and at least 12 characters (spec §9).
//
// @node-rs/argon2 exports Algorithm as an ambient `const enum`, which cannot be
// imported under isolatedModules, so the value is pinned here. 2 === Argon2id;
// the assertion in scripts/check-argon2.ts proves it against the real library.
export const ARGON2ID = 2;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return hash(password, { algorithm: ARGON2ID });
}

// The algorithm is encoded in the hash string, so verify needs no options.
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
