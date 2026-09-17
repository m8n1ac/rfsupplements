// Proves ARGON2ID === Algorithm.Argon2id against the real library, since the
// const enum cannot be imported under isolatedModules (see src/lib/password.ts).
// It is read at runtime for the same reason.
import { createRequire } from "node:module";
import { ARGON2ID, hashPassword, verifyPassword } from "../src/lib/password";

const { Algorithm } = createRequire(import.meta.url)("@node-rs/argon2") as {
  Algorithm: Record<string, number>;
};

async function main(): Promise<void> {
  if (ARGON2ID !== Algorithm.Argon2id) {
    throw new Error(`ARGON2ID is ${ARGON2ID}, but Algorithm.Argon2id is ${Algorithm.Argon2id}`);
  }

  const password = "correct horse battery staple";
  const encoded = await hashPassword(password);

  if (!encoded.startsWith("$argon2id$")) {
    throw new Error(`Expected an argon2id hash, got: ${encoded.slice(0, 20)}`);
  }
  if (!(await verifyPassword(encoded, password))) {
    throw new Error("verifyPassword rejected the correct password");
  }
  if (await verifyPassword(encoded, "wrong password entirely")) {
    throw new Error("verifyPassword accepted a wrong password");
  }

  console.log(`OK — ${encoded.slice(0, 30)}…  (Algorithm.Argon2id === ${Algorithm.Argon2id})`);
}

main();
