import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { Pagination } from "@/components/crm/pagination";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDateTime, formatMoney, orderStatusVariant } from "@/lib/format";
import { buildQuery, PAGE_SIZE, pageNumber, single, type Query } from "@/lib/search-params";
import { OrderFilters } from "@/app/(app)/orders/filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Orders · RF Supplements Ops" };

function buildWhere(query: Query): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { deletedInWoo: false };

  const status = single(query, "status");
  if (status) where.status = status;

  const payment = single(query, "payment");
  if (payment) where.paymentMethodTitle = payment;

  const from = single(query, "from");
  const to = single(query, "to");
  if (from || to) {
    where.createdAtWoo = {
      ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
      // "to" is inclusive of the whole day.
      ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
    };
  }

  const search = single(query, "q");
  if (search) {
    where.OR = [
      { number: { contains: search } },
      { contact: { email: { contains: search } } },
      { contact: { firstName: { contains: search } } },
      { contact: { lastName: { contains: search } } },
    ];
  }

  return where;
}

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  await requireUser();

  const query = (await searchParams) as Query;
  const page = pageNumber(query);
  const where = buildWhere(query);
  const coupon = single(query, "coupon");

  const [rows, total, methods] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAtWoo: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { contact: { select: { id: true, email: true, firstName: true, lastName: true } } },
    }),
    prisma.order.count({ where }),
    prisma.order.findMany({
      where: { deletedInWoo: false, paymentMethodTitle: { not: null } },
      distinct: ["paymentMethodTitle"],
      select: { paymentMethodTitle: true },
      orderBy: { paymentMethodTitle: "asc" },
    }),
  ]);

  // Coupon presence lives in a JSON column, so it is filtered after the query
  // rather than pretending MariaDB can index it.
  const visible = rows.filter((order) => {
    if (!coupon) return true;
    const codes = Array.isArray(order.couponCodes) ? order.couponCodes : [];
    return coupon === "yes" ? codes.length > 0 : codes.length === 0;
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Orders"
        description="WooCommerce is the system of record. Orders here are read-only in this phase."
      />

      <Card>
        <CardContent className="pt-6">
          <OrderFilters
            paymentMethods={methods
              .map((row) => row.paymentMethodTitle)
              .filter((value): value is string => Boolean(value))}
          />
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Empty>No orders match these filters.</Empty>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((order) => {
                  const codes = Array.isArray(order.couponCodes) ? order.couponCodes : [];
                  return (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link href={`/orders/${order.wooId}`} className="font-medium hover:underline">
                          #{order.number}
                        </Link>
                        {codes.length > 0 ? (
                          <Badge variant="outline" className="ml-2">coupon</Badge>
                        ) : null}
                        {Number(order.refundTotal) > 0 ? (
                          <Badge variant="destructive" className="ml-2">refunded</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDateTime(order.createdAtWoo)}
                      </TableCell>
                      <TableCell>
                        {order.contact ? (
                          <Link href={`/contacts/${order.contact.id}`} className="hover:underline">
                            {order.contact.email}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">no email on order</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={orderStatusVariant(order.status)}>{order.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {order.paymentMethodTitle ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(order.total)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Pagination
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
        total={total}
        buildHref={(next) => `/orders${buildQuery(query, { page: next })}`}
      />
    </div>
  );
}
