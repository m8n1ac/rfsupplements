import type { Metadata } from "next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findPendingInvite } from "@/lib/invite";
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

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome, {invite.name}</CardTitle>
          <CardDescription>
            Choose a password for {invite.email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <AlertDescription>
              This link can only be used once and expires 24 hours after it was sent.
            </AlertDescription>
          </Alert>
          <InviteFlow token={token} />
        </CardContent>
      </Card>
    </main>
  );
}
