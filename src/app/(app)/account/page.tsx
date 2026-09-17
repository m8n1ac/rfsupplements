import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/crm/page-header";
import { requireUser } from "@/lib/require-user";
import { PasswordForm } from "@/app/(app)/account/password-form";

export const metadata: Metadata = { title: "Account · RF Supplements Ops" };

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="grid gap-6">
      <PageHeader title="Account" description={user.email}>
        <Badge variant="secondary">{user.role}</Badge>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
