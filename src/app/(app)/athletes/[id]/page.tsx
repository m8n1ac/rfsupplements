import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/crm/page-header";
import { NoteList } from "@/components/crm/notes";
import { TaskList } from "@/components/crm/tasks";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDateTime, fullName } from "@/lib/format";
import { assignInquiry, setInquiryStatus } from "@/actions/inquiries";
import { INQUIRY_STATUSES } from "@/lib/inquiry";
import { ATHLETE_FORM_NAME, athleteApplication } from "@/lib/athlete";

export const metadata: Metadata = { title: "Athlete application · RF Supplements Ops" };

export default async function AthleteDetailPage({ params }: PageProps<"/athletes/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const record = await prisma.inquiry.findUnique({
    where: { id },
    include: {
      contact: true,
      assignee: { select: { id: true, name: true } },
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      tasks: {
        include: { assignee: { select: { name: true } } },
        orderBy: [{ doneAt: "asc" }, { dueAt: "asc" }],
      },
    },
  });

  // Only athlete applications open here. An ordinary inquiry reached this URL by
  // accident or by editing it, and belongs on the Inquiries screen.
  if (!record || record.formName !== ATHLETE_FORM_NAME) {
    notFound();
  }

  const staff = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const payload = (record.payload ?? {}) as Record<string, unknown>;
  const application = athleteApplication(payload);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={application.name ?? (record.contact ? fullName(record.contact) : "Athlete application")}
        description={`Applied ${formatDateTime(record.submittedAt)}`}
      >
        <Badge variant="outline">{record.status}</Badge>
        <Button asChild size="sm" variant="ghost">
          <Link href="/athletes">All applications</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Application</CardTitle>
              <CardDescription>What this person is asking for.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tier requested">
                {application.tier ? <Badge variant="secondary">{application.tier}</Badge> : "—"}
              </Field>
              <Field label="Sport">{application.sport ?? "—"}</Field>
              <Field label="Instagram">
                {application.instagramUrl ? (
                  <a
                    href={application.instagramUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline"
                  >
                    @{application.instagram}
                  </a>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Email">
                {application.email ?? record.contact?.email ?? "—"}
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>In their words</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">
                {application.about ?? (
                  <span className="text-muted-foreground">Nothing written.</span>
                )}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Everything the form sent</CardTitle>
              <CardDescription>Field by field, exactly as submitted.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                {Object.entries(payload).map(([field, value]) => (
                  <div key={field} className="grid gap-0.5">
                    <dt className="text-muted-foreground text-xs tracking-wide uppercase">
                      {field}
                    </dt>
                    <dd className="text-sm whitespace-pre-wrap">
                      {Array.isArray(value) ? value.join(", ") : String(value ?? "—")}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <NoteList notes={record.notes} target={{ inquiryId: record.id }} currentUserId={user.id} />
          <TaskList tasks={record.tasks} target={{ inquiryId: record.id }} staff={staff} />
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form action={setInquiryStatus.bind(null, record.id)} className="grid gap-2">
                <label
                  htmlFor="status"
                  className="text-muted-foreground text-xs tracking-wide uppercase"
                >
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={record.status}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  {INQUIRY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  Update status
                </Button>
              </form>

              <form action={assignInquiry.bind(null, record.id)} className="grid gap-2">
                <label
                  htmlFor="assigneeId"
                  className="text-muted-foreground text-xs tracking-wide uppercase"
                >
                  Assignee
                </label>
                <select
                  id="assigneeId"
                  name="assigneeId"
                  defaultValue={record.assignee?.id ?? ""}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  <option value="">Unassigned</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  Assign
                </Button>
              </form>
            </CardContent>
          </Card>

          {record.contact ? (
            <Card>
              <CardHeader>
                <CardTitle>Contact</CardTitle>
                <CardDescription>
                  Matched on the email they applied with.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href={`/contacts/${record.contact.id}`} className="text-sm underline">
                  {fullName(record.contact)}
                </Link>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground text-xs tracking-wide uppercase">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
