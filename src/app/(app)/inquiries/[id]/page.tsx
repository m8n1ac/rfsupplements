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

export const metadata: Metadata = { title: "Inquiry · RF Supplements Ops" };

export default async function InquiryDetailPage({ params }: PageProps<"/inquiries/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const inquiry = await prisma.inquiry.findUnique({
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

  if (!inquiry) {
    notFound();
  }

  const staff = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const payload = (inquiry.payload ?? {}) as Record<string, unknown>;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={inquiry.formName}
        description={`Received ${formatDateTime(inquiry.submittedAt)}`}
      >
        <Badge variant="outline">{inquiry.status}</Badge>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Submission</CardTitle>
              <CardDescription>Exactly what the form sent, field by field.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                {Object.entries(payload).map(([field, value]) => (
                  <div key={field} className="grid gap-0.5">
                    <dt className="text-muted-foreground text-xs uppercase tracking-wide">{field}</dt>
                    <dd className="text-sm whitespace-pre-wrap">
                      {Array.isArray(value) ? value.join(", ") : String(value ?? "—")}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <NoteList notes={inquiry.notes} target={{ inquiryId: inquiry.id }} currentUserId={user.id} />
          <TaskList tasks={inquiry.tasks} target={{ inquiryId: inquiry.id }} staff={staff} />
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form action={setInquiryStatus.bind(null, inquiry.id)} className="grid gap-2">
                <label htmlFor="status" className="text-muted-foreground text-xs uppercase tracking-wide">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={inquiry.status}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  {INQUIRY_STATUSES.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">Update status</Button>
              </form>

              <form action={assignInquiry.bind(null, inquiry.id)} className="grid gap-2">
                <label htmlFor="assigneeId" className="text-muted-foreground text-xs uppercase tracking-wide">
                  Assignee
                </label>
                <select
                  id="assigneeId"
                  name="assigneeId"
                  defaultValue={inquiry.assignee?.id ?? ""}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  <option value="">Unassigned</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">Assign</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timing</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {[
                ["Received", formatDateTime(inquiry.submittedAt)],
                ["First response", formatDateTime(inquiry.firstResponseAt)],
                ["Closed", formatDateTime(inquiry.closedAt)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {inquiry.contact ? (
                <div className="grid gap-1">
                  <Link href={`/contacts/${inquiry.contact.id}`} className="font-medium hover:underline">
                    {fullName(inquiry.contact)}
                  </Link>
                  <span className="text-muted-foreground">{inquiry.contact.email}</span>
                  <span className="text-muted-foreground">
                    {inquiry.contact.ordersCount} order{inquiry.contact.ordersCount === 1 ? "" : "s"}
                  </span>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No email on the submission, so it is not linked to a contact.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
