import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ClipboardList,
  FileText,
  Inbox,
  Pencil,
  ReceiptText,
  RotateCcw,
  ShoppingCart,
} from "lucide-react";
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
import { Empty } from "@/components/crm/empty";
import { PageHeader } from "@/components/crm/page-header";
import { NoteList } from "@/components/crm/notes";
import { TaskList } from "@/components/crm/tasks";
import { TagEditor } from "@/components/crm/tags";
import { ContactEditor, type Address } from "@/components/crm/contact-editor";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDate, formatDateTime, formatMoney, fullName, orderStatusVariant } from "@/lib/format";
import type { ActivityType } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Contact · RF Supplements Ops" };

const ACTIVITY_ICONS: Record<ActivityType, typeof ShoppingCart> = {
  ORDER_PLACED: ShoppingCart,
  ORDER_STATUS: RotateCcw,
  REFUND: ReceiptText,
  INQUIRY: Inbox,
  NOTE: FileText,
  TASK_DONE: ClipboardList,
  FIELD_EDIT: Pencil,
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

export default async function ContactDetailPage({ params }: PageProps<"/contacts/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      tags: { include: { tag: true } },
      owner: { select: { name: true } },
      orders: {
        where: { deletedInWoo: false },
        orderBy: { createdAtWoo: "desc" },
        take: 50,
      },
      inquiries: { orderBy: { submittedAt: "desc" }, take: 20 },
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      tasks: {
        include: { assignee: { select: { name: true } } },
        orderBy: [{ doneAt: "asc" }, { dueAt: "asc" }],
      },
      activities: { orderBy: { occurredAt: "desc" }, take: 50 },
      affiliate: {
        select: { id: true, status: true, commissionRate: true, unpaidCommission: true },
      },
    },
  });

  if (!contact) {
    notFound();
  }

  const staff = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="grid gap-6">
      <PageHeader title={fullName(contact)} description={contact.email}>
        <Badge variant="secondary">{contact.source.replace("WOO_", "").toLowerCase()}</Badge>
        {contact.deletedInWoo ? <Badge variant="destructive">deleted in Woo</Badge> : null}
        {/* A contact who is also an affiliate is a different relationship: they
            are owed money as well as having spent it. */}
        {contact.affiliate ? (
          <Badge asChild variant="outline">
            <Link href={`/affiliates/${contact.affiliate.id}`}>
              affiliate · {Number(contact.affiliate.commissionRate).toFixed(0)}%
              {Number(contact.affiliate.unpaidCommission) > 0
                ? ` · ${formatMoney(contact.affiliate.unpaidCommission)} owed`
                : ""}
            </Link>
          </Badge>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Orders</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {contact.orders.length === 0 ? (
                <Empty>No orders yet.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Placed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contact.orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link href={`/orders/${order.wooId}`} className="font-medium hover:underline">
                            #{order.number}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {formatDate(order.createdAtWoo)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={orderStatusVariant(order.status)}>{order.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatMoney(order.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {contact.inquiries.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Inquiries</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {contact.inquiries.map((inquiry) => (
                  <Link
                    key={inquiry.id}
                    href={`/inquiries/${inquiry.id}`}
                    className="hover:bg-muted flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <span>{inquiry.formName}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{inquiry.status}</Badge>
                      <span className="text-muted-foreground">{formatDate(inquiry.submittedAt)}</span>
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <NoteList notes={contact.notes} target={{ contactId: contact.id }} currentUserId={user.id} />
          <TaskList tasks={contact.tasks} target={{ contactId: contact.id }} staff={staff} />
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Stats</CardTitle>
              {user.role !== "ADMIN" ? (
                <CardDescription>Revenue figures are visible to administrators.</CardDescription>
              ) : null}
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <Stat label="Orders" value={String(contact.ordersCount)} />
                {user.role === "ADMIN" ? (
                  <>
                    <Stat label="Lifetime" value={formatMoney(contact.lifetimeValue)} />
                    <Stat label="Avg order" value={formatMoney(contact.avgOrderValue)} />
                  </>
                ) : null}
                <Stat label="First order" value={formatDate(contact.firstOrderAt)} />
                <Stat label="Last order" value={formatDate(contact.lastOrderAt)} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                {contact.wooCustomerId
                  ? "Edits are written to WooCommerce."
                  : "A guest buyer with no WooCommerce customer record."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {[
                ["Email", contact.email],
                ["Phone", contact.phone ?? "—"],
                ["Company", contact.company ?? "—"],
                ["Woo customer", contact.wooCustomerId ? `#${contact.wooCustomerId}` : "guest"],
                ["Owner", contact.owner?.name ?? "unassigned"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right">{value}</span>
                </div>
              ))}
              <div className="mt-2">
                <ContactEditor
                  contactId={contact.id}
                  isWooCustomer={contact.wooCustomerId !== null}
                  email={contact.email}
                  firstName={contact.firstName}
                  lastName={contact.lastName}
                  phone={contact.phone}
                  billing={contact.billing as Address | null}
                  shipping={contact.shipping as Address | null}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <TagEditor
                contactId={contact.id}
                tags={contact.tags.map((link) => ({ tagId: link.tagId, name: link.tag.name }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {contact.activities.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
              ) : (
                <ol className="grid gap-3">
                  {contact.activities.map((activity) => {
                    const Icon = ACTIVITY_ICONS[activity.type];
                    return (
                      <li key={activity.id} className="flex gap-3">
                        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        <div className="grid">
                          <span className="text-sm">{activity.summary}</span>
                          <span className="text-muted-foreground text-xs">
                            {formatDateTime(activity.occurredAt)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
