import type { Metadata } from "next";
import Link from "next/link";
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
import { formatDate, formatMoney, formatRelative, fullName } from "@/lib/format";
import { buildQuery, PAGE_SIZE, pageNumber, single, type Query } from "@/lib/search-params";
import { SEGMENTS, segmentWhere } from "@/app/(app)/contacts/segments";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Contacts · RF Supplements Ops" };

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const user = await requireUser();

  const query = (await searchParams) as Query;
  const page = pageNumber(query);
  const segment = single(query, "segment") ?? "all";
  const search = single(query, "q");
  const tag = single(query, "tag");

  const where: Prisma.ContactWhereInput = {
    deletedInWoo: false,
    ...segmentWhere(segment),
    ...(tag ? { tags: { some: { tag: { name: tag } } } } : {}),
    ...(search
      ? {
          OR: [
            { email: { contains: search } },
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };

  const [rows, total, tags] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ lastOrderAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { tags: { include: { tag: true } } },
    }),
    prisma.contact.count({ where }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="grid gap-6">
      <PageHeader title="Contacts" description="Customers, guest buyers, and form leads in one list." />

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="flex flex-wrap gap-2">
            {SEGMENTS.map((option) => (
              <Button
                key={option.key}
                asChild
                size="sm"
                variant={segment === option.key ? "default" : "outline"}
              >
                <Link href={`/contacts${buildQuery(query, { segment: option.key, page: undefined })}`}>
                  {option.label}
                </Link>
              </Button>
            ))}
          </div>

          {tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-sm">Tags:</span>
              {tags.map((row) => (
                <Button
                  key={row.id}
                  asChild
                  size="sm"
                  variant={tag === row.name ? "secondary" : "ghost"}
                >
                  <Link
                    href={`/contacts${buildQuery(query, {
                      tag: tag === row.name ? undefined : row.name,
                      page: undefined,
                    })}`}
                  >
                    {row.name}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null}

          <form action="/contacts" className="flex gap-2">
            <input type="hidden" name="segment" value={segment} />
            {tag ? <input type="hidden" name="tag" value={tag} /> : null}
            <Input name="q" defaultValue={search ?? ""} placeholder="Name, email, or phone" />
            <Button type="submit" size="sm">Search</Button>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Empty>No contacts match this view.</Empty>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  {user.role === "ADMIN" ? <TableHead className="text-right">Lifetime</TableHead> : null}
                  <TableHead>Last order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                        {fullName(contact)}
                      </Link>
                      {contact.tags.length > 0 ? (
                        <span className="ml-2 inline-flex gap-1">
                          {contact.tags.map((link) => (
                            <Badge key={link.tagId} variant="outline">{link.tag.name}</Badge>
                          ))}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contact.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{contact.source.replace("WOO_", "").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{contact.ordersCount}</TableCell>
                    {user.role === "ADMIN" ? (
                      <TableCell className="text-right">{formatMoney(contact.lifetimeValue)}</TableCell>
                    ) : null}
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {contact.lastOrderAt ? (
                        <span title={formatDate(contact.lastOrderAt)}>
                          {formatRelative(contact.lastOrderAt)}
                        </span>
                      ) : (
                        "never"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Pagination
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
        total={total}
        buildHref={(next) => `/contacts${buildQuery(query, { page: next })}`}
      />
    </div>
  );
}
