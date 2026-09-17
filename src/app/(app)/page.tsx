import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/require-user";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Signed in as {user.name}.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Phase 1 — foundation</CardTitle>
          <CardDescription>
            Auth, the database, and the app shell are in place. Store data arrives
            with the inbound sync in Phase 2, and the revenue widgets in Phase 4.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {user.role === "ADMIN"
            ? "You have the ADMIN role, so revenue and settings will be visible to you."
            : "You have the STAFF role. Revenue reporting and settings stay hidden."}
        </CardContent>
      </Card>
    </div>
  );
}
