// Seeds a user and prints a single-use invite link (spec §9).
//   npm run user:create -- --email you@example.com --name "Your Name" --role ADMIN
//
// The invite link is printed rather than emailed, so the first ADMIN can be
// created before SMTP credentials exist.
// Side-effect import, so .env is loaded before any module reads process.env.
import "dotenv/config";

import { prisma } from "../src/lib/db";
import { createInvite, inviteUrl, INVITE_TTL_HOURS } from "../src/lib/invite";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const role = arg("role")?.trim().toUpperCase();

  if (!email || !name || (role !== "ADMIN" && role !== "STAFF")) {
    throw new Error(
      'Usage: npm run user:create -- --email <email> --name "<name>" --role <ADMIN|STAFF>',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error(`A user with email ${email} already exists`);
  }

  const user = await prisma.user.create({ data: { email, name, role } });

  // The seed admin has no inviter, so the invite records itself as its creator.
  const token = await createInvite(user.id, user.id);

  console.log(`Created ${role} ${email}`);
  console.log(`Invite link (single use, expires in ${INVITE_TTL_HOURS}h):`);
  console.log(inviteUrl(token));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
