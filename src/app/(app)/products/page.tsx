import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { formatMoney } from "@/lib/format";
import { buildQuery, PAGE_SIZE, pageNumber, single, type Query } from "@/lib/search-params";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Products · RF Supplements Ops" };

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const user = await requireUser();

  const query = (await searchParams) as Query;
  const page = pageNumber(query);
  const search = single(query, "q");
  const stock = single(query, "stock");

  const where: Prisma.ProductWhereInput = {
    deletedInWoo: false,
    ...(stock ? { stockStatus: stock } : {}),
    ...(search
      ? { OR: [{ name: { contains: search } }, { sku: { contains: search } }] }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ parentWooId: "asc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.product.count({ where }),
  ]);

  // Units sold per product, from the order items already in the CRM. Revenue by
  // period arrives with the metrics work in Phase 4.
  const wooIds = rows.flatMap((product) => [product.wooId]);
  const sold = await prisma.orderItem.groupBy({
    by: ["productWooId", "variationWooId"],
    where: {
      order: { deletedInWoo: false, status: { notIn: ["pending", "failed", "cancelled"] } },
      OR: [{ productWooId: { in: wooIds } }, { variationWooId: { in: wooIds } }],
    },
    _sum: { quantity: true, total: true },
  });

  const unitsByWooId = new Map<number, { units: number; revenue: number }>();
  for (const row of sold) {
    // A variation's sales belong to the variation; everything else to the product.
    const key = row.variationWooId ?? row.productWooId;
    if (key === null) continue;
    const current = unitsByWooId.get(key) ?? { units: 0, revenue: 0 };
    current.units += row._sum.quantity ?? 0;
    current.revenue += Number(row._sum.total ?? 0);
    unitsByWooId.set(key, current);
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Products"
        description="Read-only. Prices, stock and the catalog are managed in wp-admin."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <form action="/products" className="flex flex-1 gap-2">
            {stock ? <input type="hidden" name="stock" value={stock} /> : null}
            <Input name="q" defaultValue={search ?? ""} placeholder="Name or SKU" />
            <Button type="submit" size="sm">Search</Button>
          </form>
          <div className="flex gap-1">
            {[
              { value: "", label: "All" },
              { value: "instock", label: "In stock" },
              { value: "outofstock", label: "Out of stock" },
            ].map((option) => (
              <Button
                key={option.label}
                asChild
                size="sm"
                variant={(stock ?? "") === option.value ? "secondary" : "ghost"}
              >
                <a href={`/products${buildQuery(query, { stock: option.value || undefined, page: undefined })}`}>
                  {option.label}
                </a>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Empty>No products match.</Empty>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Units sold</TableHead>
                  {user.role === "ADMIN" ? <TableHead className="text-right">Revenue</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((product) => {
                  const stats = unitsByWooId.get(product.wooId);
                  return (
                    <TableRow key={product.id}>
                      <TableCell className={product.parentWooId ? "pl-8 text-muted-foreground" : "font-medium"}>
                        {product.name}
                        {product.status !== "publish" ? (
                          <Badge variant="outline" className="ml-2">{product.status}</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{product.sku ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{product.type}</TableCell>
                      <TableCell>
                        <Badge variant={product.stockStatus === "instock" ? "secondary" : "destructive"}>
                          {product.stockStatus ?? "—"}
                        </Badge>
                        {product.stockQuantity !== null ? (
                          <span className="text-muted-foreground ml-2 text-xs">{product.stockQuantity}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">{formatMoney(product.price)}</TableCell>
                      <TableCell className="text-right">{stats?.units ?? 0}</TableCell>
                      {user.role === "ADMIN" ? (
                        <TableCell className="text-right">
                          {stats ? formatMoney(stats.revenue.toFixed(2)) : formatMoney("0")}
                        </TableCell>
                      ) : null}
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
        buildHref={(next) => `/products${buildQuery(query, { page: next })}`}
      />
    </div>
  );
}
