import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { fullName } from "@/lib/format";

// Backs the ⌘K palette. Like every other route handler it calls requireUser,
// so it can never return data to someone who is not signed in.
const schema = z.object({ q: z.string().trim().min(1).max(100) });

export type SearchHit = {
  id: string;
  href: string;
  kind: "contact" | "order" | "inquiry";
  title: string;
  subtitle: string;
};

export async function GET(request: Request): Promise<NextResponse> {
  await requireUser();

  const parsed = schema.safeParse({
    q: new URL(request.url).searchParams.get("q") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json({ hits: [] satisfies SearchHit[] });
  }

  const term = parsed.data.q;

  const [contacts, orders, inquiries] = await Promise.all([
    prisma.contact.findMany({
      where: {
        deletedInWoo: false,
        OR: [
          { email: { contains: term } },
          { firstName: { contains: term } },
          { lastName: { contains: term } },
          { phone: { contains: term } },
        ],
      },
      take: 6,
      orderBy: { lastOrderAt: "desc" },
    }),
    prisma.order.findMany({
      where: {
        deletedInWoo: false,
        OR: [{ number: { contains: term } }, { contact: { email: { contains: term } } }],
      },
      take: 6,
      orderBy: { createdAtWoo: "desc" },
      include: { contact: { select: { email: true } } },
    }),
    prisma.inquiry.findMany({
      where: {
        OR: [{ formName: { contains: term } }, { message: { contains: term } }],
      },
      take: 6,
      orderBy: { submittedAt: "desc" },
      include: { contact: { select: { email: true } } },
    }),
  ]);

  const hits: SearchHit[] = [
    ...contacts.map((contact) => ({
      id: contact.id,
      href: `/contacts/${contact.id}`,
      kind: "contact" as const,
      title: fullName(contact),
      subtitle: contact.email,
    })),
    ...orders.map((order) => ({
      id: order.id,
      href: `/orders/${order.wooId}`,
      kind: "order" as const,
      title: `Order #${order.number}`,
      subtitle: order.contact?.email ?? order.status,
    })),
    ...inquiries.map((inquiry) => ({
      id: inquiry.id,
      href: `/inquiries/${inquiry.id}`,
      kind: "inquiry" as const,
      title: inquiry.formName,
      subtitle: inquiry.contact?.email ?? inquiry.status,
    })),
  ];

  return NextResponse.json({ hits });
}
