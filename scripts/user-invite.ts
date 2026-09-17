// Reissues a single-use invite link for an existing user and prints it.
//   npm run user:invite -- --email you@example.com
//
// The in-app "Resend invite" button needs an administrator to be signed in, so
// this is the way back if the seed admin's own invite expires before they use
// it. Issuing a new invite invalidates any outstanding one for that user.
import "dotenv/config";

import { prisma } from "../src/lib/db";
import { createInvite, inviteUrl, INVITE_TTL_HOURS } from "../src/lib/invite";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const email = arg("email")?.trim().toLowerCase();
  if (!email) {
    throw new Error("Usage: npm run user:invite -- --email <email>");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, active: true, passwordHash: true, totpEnrolledAt: true },
  });

  if (!user) {
    throw new Error(`No user with email ${email}`);
  }
  if (!user.active) {
    throw new Error(`${email} is deactivated. Reactivate them first.`);
  }
  if (user.passwordHash && user.totpEnrolledAt) {
    throw new Error(
      `${email} has already completed setup. Use a password/2FA reset instead of an invite.`,
    );
  }

  const token = await createInvite(user.id, user.id);

  console.log(`Invite for ${user.name} <${email}> (single use, expires in ${INVITE_TTL_HOURS}h):`);
  console.log(inviteUrl(token));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
