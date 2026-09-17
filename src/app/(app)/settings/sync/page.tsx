import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { RESOURCES } from "@/lib/sync/engine";
import { RunFullSyncButton } from "@/app/(app)/settings/sync/run-full-sync";

export const metadata: Metadata = { title: "Sync · RF Supplements Ops" };

function stamp(value: Date | null): string {
  return value ? value.toISOString().slice(0, 19).replace("T", " ") : "—";
}

export default async function SyncPage() {
  await requireUser("ADMIN");

  const [cursors, runs] = await Promise.all([
    prisma.syncCursor.findMany(),
    prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 25 }),
  ]);

  const byResource = new Map(cursors.map((cursor) => [cursor.resource, cursor]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Sync</h1>
        <p className="text-muted-foreground">
          WooCommerce is the system of record. The CRM pulls every 60 seconds and
          does a full pass nightly at 04:30 Pacific. All times below are UTC.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Health</CardTitle>
          <CardDescription>
            One cursor per resource. Consecutive failures reaching 3 sends a single alert email.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Cursor</TableHead>
                <TableHead>Last success</TableHead>
                <TableHead>Consecutive failures</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RESOURCES.map((resource) => {
                const cursor = byResource.get(resource);
                const failures = cursor?.consecutiveFailures ?? 0;
                return (
                  <TableRow key={resource}>
                    <TableCell className="font-medium">{resource}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {stamp(cursor?.lastModifiedGmt ?? null)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {stamp(cursor?.lastSuccessAt ?? null)}
                    </TableCell>
                    <TableCell>
                      {failures === 0 ? (
                        <Badge variant="secondary">0</Badge>
                      ) : (
                        <Badge variant="destructive">{failures}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <RunFullSyncButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Fetched</TableHead>
                <TableHead className="text-right">Upserted</TableHead>
                <TableHead className="text-right">Deleted</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No runs yet.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-muted-foreground">{stamp(run.startedAt)}</TableCell>
                    <TableCell>{run.resource}</TableCell>
                    <TableCell>{run.mode}</TableCell>
                    <TableCell className="text-right">{run.fetched}</TableCell>
                    <TableCell className="text-right">{run.upserted}</TableCell>
                    <TableCell className="text-right">{run.markedDeleted}</TableCell>
                    <TableCell>
                      {run.error ? (
                        <span className="text-destructive text-xs">{run.error.slice(0, 120)}</span>
                      ) : run.finishedAt ? (
                        <Badge>ok</Badge>
                      ) : (
                        <Badge variant="outline">running</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
