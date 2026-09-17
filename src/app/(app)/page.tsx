import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/crm/empty";
import { PageHeader } from "@/components/crm/page-header";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDate, formatMoney, formatRelative, orderStatusVariant } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard · RF Supplements Ops" };

function Tile({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href}>
      <Card className="hover:border-foreground/20 transition-colors">
        <CardContent className="py-5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  // Ops queues only. Revenue KPIs and charts arrive in Phase 4, and stay ADMIN.
  const [newInquiries, myOpenTasks, overdueTasks, onHoldOrders, recentOrders] = await Promise.all([
    prisma.inquiry.count({ where: { status: "NEW" } }),
    prisma.task.count({ where: { assigneeId: user.id, doneAt: null } }),
    prisma.task.count({ where: { doneAt: null, dueAt: { lt: now } } }),
    prisma.order.count({ where: { deletedInWoo: false, status: "on-hold" } }),
    prisma.order.findMany({
      where: { deletedInWoo: false },
      orderBy: { createdAtWoo: "desc" },
      take: 8,
      include: { contact: { select: { id: true, email: true } } },
    }),
  ]);

  return (
    <div className="grid gap-6">
      <PageHeader title="Dashboard" description={`Signed in as ${user.name}.`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="New inquiries" value={newInquiries} href="/inquiries" />
        <Tile label="My open tasks" value={myOpenTasks} href="/tasks?scope=mine" />
        <Tile label="Overdue tasks" value={overdueTasks} href="/tasks?scope=all&due=overdue" />
        <Tile label="Orders on hold" value={onHoldOrders} href="/orders?status=on-hold" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest orders</CardTitle>
          {user.role === "ADMIN" ? (
            <CardDescription>Revenue reporting arrives in Phase 4.</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2">
          {recentOrders.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : (
            recentOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
              >
                <Link href={`/orders/${order.wooId}`} className="font-medium hover:underline">
                  #{order.number}
                </Link>
                <span className="text-muted-foreground flex-1 truncate">
                  {order.contact ? order.contact.email : "no email on order"}
                </span>
                <Badge variant={orderStatusVariant(order.status)}>{order.status}</Badge>
                <span className="text-muted-foreground" title={formatDate(order.createdAtWoo)}>
                  {formatRelative(order.createdAtWoo)}
                </span>
                {user.role === "ADMIN" ? (
                  <span className="w-20 text-right font-medium">{formatMoney(order.total)}</span>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
