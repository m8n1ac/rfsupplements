import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import { OrderStatusControl } from "@/components/crm/order-status-control";
import { WooNoteForm } from "@/components/crm/woo-note-form";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDateTime, formatMoney, fullName, orderStatusVariant } from "@/lib/format";

export const metadata: Metadata = { title: "Order · RF Supplements Ops" };

type Address = Record<string, string | undefined>;

type TrackingItem = {
  tracking_number?: string;
  tracking_provider?: string;
  custom_tracking_provider?: string;
  custom_tracking_link?: string;
};

function AddressBlock({ address }: { address: Address | null }) {
  if (!address) return <p className="text-muted-foreground text-sm">—</p>;

  const lines = [
    [address.first_name, address.last_name].filter(Boolean).join(" "),
    address.company,
    address.address_1,
    address.address_2,
    [address.city, address.state, address.postcode].filter(Boolean).join(", "),
    address.country,
    address.phone,
    address.email,
  ].filter((line) => line && line.trim());

  if (lines.length === 0) return <p className="text-muted-foreground text-sm">—</p>;

  return (
    <address className="text-sm not-italic leading-relaxed">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </address>
  );
}

function Money({ label, value, strong }: { label: string; value: unknown; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 text-sm ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span>{formatMoney(value as { toString(): string })}</span>
    </div>
  );
}

export default async function OrderDetailPage({ params }: PageProps<"/orders/[wooId]">) {
  const user = await requireUser();
  const { wooId } = await params;

  const order = await prisma.order.findUnique({
    where: { wooId: Number(wooId) },
    include: {
      contact: true,
      items: { orderBy: { wooLineItemId: "asc" } },
      refunds: { orderBy: { createdAtWoo: "desc" } },
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      tasks: {
        include: { assignee: { select: { name: true } } },
        orderBy: [{ doneAt: "asc" }, { dueAt: "asc" }],
      },
    },
  });

  if (!order) {
    notFound();
  }

  const codes = Array.isArray(order.couponCodes) ? (order.couponCodes as string[]) : [];
  const tracking = Array.isArray(order.tracking) ? (order.tracking as TrackingItem[]) : [];
  const staff = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="grid gap-6">
      <PageHeader title={`Order #${order.number}`} description={formatDateTime(order.createdAtWoo)}>
        <Badge variant={orderStatusVariant(order.status)}>{order.status}</Badge>
        {order.deletedInWoo ? <Badge variant="destructive">trashed in Woo</Badge> : null}
        <Button asChild variant="outline" size="sm">
          <a
            href={`https://rfsupplements.com/wp-admin/admin.php?page=wc-orders&action=edit&id=${order.wooId}`}
            target="_blank"
            rel="noreferrer"
          >
            View in wp-admin <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.sku ?? "—"}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatMoney(item.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator />

              <div className="ml-auto grid w-full max-w-xs gap-1">
                <Money label="Subtotal" value={order.subtotal} />
                <Money label="Discount" value={order.discountTotal} />
                <Money label="Shipping" value={order.shippingTotal} />
                <Money label="Tax" value={order.taxTotal} />
                <Separator className="my-1" />
                <Money label="Total" value={order.total} strong />
                {Number(order.refundTotal) > 0 ? (
                  <Money label="Refunded" value={order.refundTotal} />
                ) : null}
              </div>
            </CardContent>
          </Card>

          {order.refunds.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Refunds</CardTitle>
                <CardDescription>Refunds are issued in wp-admin, never from the CRM.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.refunds.map((refund) => (
                      <TableRow key={refund.id}>
                        <TableCell>{formatDateTime(refund.createdAtWoo)}</TableCell>
                        <TableCell className="text-muted-foreground">{refund.reason ?? "—"}</TableCell>
                        <TableCell className="text-right">{formatMoney(refund.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <WooNoteForm wooId={order.wooId} />

          <NoteList
            notes={order.notes}
            target={{ orderId: order.id }}
            currentUserId={user.id}
          />

          <TaskList
            tasks={order.tasks}
            target={{ orderId: order.id }}
            staff={staff}
          />
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {order.contact ? (
                <>
                  <Link href={`/contacts/${order.contact.id}`} className="font-medium hover:underline">
                    {fullName(order.contact)}
                  </Link>
                  <p className="text-muted-foreground">{order.contact.email}</p>
                  <p className="text-muted-foreground">
                    {order.contact.ordersCount} order{order.contact.ordersCount === 1 ? "" : "s"} ·{" "}
                    {formatMoney(order.contact.lifetimeValue)} lifetime
                  </p>
                </>
              ) : (
                <Empty>
                  This order carries no billing email, so it is not linked to a contact.
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Written to WooCommerce, which is the system of record.</CardDescription>
            </CardHeader>
            <CardContent>
              <OrderStatusControl wooId={order.wooId} current={order.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Shipment</CardTitle>
              <CardDescription>
                Tracking comes from whichever label service shipped it.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {tracking.length === 0 ? (
                <p className="text-muted-foreground">Not shipped yet.</p>
              ) : (
                tracking.map((item) => (
                  <div key={item.tracking_number} className="grid gap-1">
                    <span className="text-muted-foreground text-xs uppercase tracking-wide">
                      {item.custom_tracking_provider || item.tracking_provider || "Carrier"}
                    </span>
                    {item.custom_tracking_link ? (
                      <a
                        href={item.custom_tracking_link}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sm break-all hover:underline"
                      >
                        {item.tracking_number}
                      </a>
                    ) : (
                      <span className="font-mono text-sm break-all">{item.tracking_number}</span>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Method</span>
                <span>{order.paymentMethodTitle ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Paid</span>
                <span>{formatDateTime(order.paidAtWoo)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Completed</span>
                <span>{formatDateTime(order.completedAtWoo)}</span>
              </div>
              {codes.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">Coupons</span>
                  <span className="flex flex-wrap gap-1">
                    {codes.map((code) => (
                      <Badge key={code} variant="outline">{code}</Badge>
                    ))}
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Billing</CardTitle>
            </CardHeader>
            <CardContent>
              <AddressBlock address={order.billing as Address | null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Shipping</CardTitle>
            </CardHeader>
            <CardContent>
              <AddressBlock address={order.shipping as Address | null} />
            </CardContent>
          </Card>

          {order.customerNote ? (
            <Card>
              <CardHeader>
                <CardTitle>Customer note</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">{order.customerNote}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
