import type { Metadata } from "next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { findPendingInvite } from "@/lib/invite";
import { createTotpSecret, totpQrDataUrl, totpUri } from "@/lib/totp";
import { InviteFlow } from "@/app/invite/[token]/invite-flow";

export const metadata: Metadata = { title: "Set up your account · RF Supplements Ops" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await findPendingInvite(token);

  if (!invite) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>This invite is not valid</CardTitle>
            <CardDescription>
              It may have expired, already been used, or been replaced by a newer
              one. Ask an administrator to send another.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: invite.userId },
    select: { passwordHash: true, totpSecret: true },
  });

  // The password comes first. Only once it is set do we mint the TOTP secret —
  // and we mint it once, so reloading this page mid-enrolment does not
  // invalidate a secret the user has already scanned.
  if (!user.passwordHash) {
    return (
      <Shell email={invite.email} name={invite.name}>
        <InviteFlow token={token} step="password" />
      </Shell>
    );
  }

  let secret = user.totpSecret ? decrypt(user.totpSecret) : null;
  if (!secret) {
    secret = createTotpSecret();
    await prisma.user.update({
      where: { id: invite.userId },
      data: { totpSecret: encrypt(secret) },
    });
  }

  const qrDataUrl = await totpQrDataUrl(totpUri(secret, invite.email));

  return (
    <Shell email={invite.email} name={invite.name}>
      <InviteFlow token={token} step="totp" qrDataUrl={qrDataUrl} secret={secret} />
    </Shell>
  );
}

function Shell({
  email,
  name,
  children,
}: {
  email: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome, {name}</CardTitle>
          <CardDescription>
            Set up your RF Supplements Ops account for {email}. Two-factor
            authentication is required for every user.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <AlertDescription>
              This link can only be used once and expires 24 hours after it was sent.
            </AlertDescription>
          </Alert>
          {children}
        </CardContent>
      </Card>
    </main>
  );
}
