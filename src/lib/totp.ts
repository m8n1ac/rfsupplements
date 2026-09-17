import { randomBytes } from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { ARGON2ID } from "@/lib/password";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

// TOTP is mandatory for every user (spec §9). Secrets are generated here,
// encrypted by src/lib/crypto.ts, and stored on User.totpSecret.

const ISSUER = "RF Supplements Ops";
export const RECOVERY_CODE_COUNT = 8;

const ARGON_OPTIONS = { algorithm: ARGON2ID } as const;

export function createTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, email: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret });
}

export function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  const result = await verify({ secret, token });
  return result.valid;
}

// Recovery codes are shown once at enrollment and stored only as argon2id hashes.
export function createRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-"),
  );
}

export function hashRecoveryCode(code: string): Promise<string> {
  return argonHash(normalizeRecoveryCode(code), ARGON_OPTIONS);
}

export function verifyRecoveryCode(codeHash: string, code: string): Promise<boolean> {
  return argonVerify(codeHash, normalizeRecoveryCode(code));
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
}
