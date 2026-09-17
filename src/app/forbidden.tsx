import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Forbidden() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>403 — not your area</CardTitle>
          <CardDescription>
            This section is limited to administrators.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/">Back to the dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
