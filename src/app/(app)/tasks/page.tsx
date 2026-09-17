import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty } from "@/components/crm/empty";
import { PageHeader } from "@/components/crm/page-header";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDate } from "@/lib/format";
import { buildQuery, single, type Query } from "@/lib/search-params";
import { setTaskDone } from "@/actions/tasks";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Tasks · RF Supplements Ops" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const user = await requireUser();

  const query = (await searchParams) as Query;
  const scope = single(query, "scope") ?? "mine";
  const due = single(query, "due");

  const endOfToday = new Date();
  endOfToday.setUTCHours(23, 59, 59, 999);

  const where: Prisma.TaskWhereInput = {
    ...(scope === "mine" ? { assigneeId: user.id } : {}),
    ...(scope === "done" ? { doneAt: { not: null } } : { doneAt: null }),
    ...(due === "overdue" ? { dueAt: { lt: new Date() } } : {}),
    ...(due === "today" ? { dueAt: { lte: endOfToday } } : {}),
  };

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    include: {
      assignee: { select: { name: true } },
      contact: { select: { id: true, email: true } },
      order: { select: { wooId: true, number: true } },
      inquiry: { select: { id: true, formName: true } },
    },
    take: 200,
  });

  return (
    <div className="grid gap-6">
      <PageHeader title="Tasks" description="Follow-ups attached to contacts, orders and inquiries." />

      <Card>
        <CardContent className="flex flex-wrap gap-4 pt-6">
          <div className="flex gap-1">
            {[
              { value: "mine", label: "My tasks" },
              { value: "all", label: "All open" },
              { value: "done", label: "Completed" },
            ].map((option) => (
              <Button
                key={option.value}
                asChild
                size="sm"
                variant={scope === option.value ? "secondary" : "ghost"}
              >
                <Link href={`/tasks${buildQuery(query, { scope: option.value })}`}>{option.label}</Link>
              </Button>
            ))}
          </div>
          <div className="flex gap-1">
            {[
              { value: "", label: "Any date" },
              { value: "today", label: "Due today" },
              { value: "overdue", label: "Overdue" },
            ].map((option) => (
              <Button
                key={option.label}
                asChild
                size="sm"
                variant={(due ?? "") === option.value ? "secondary" : "ghost"}
              >
                <Link href={`/tasks${buildQuery(query, { due: option.value || undefined })}`}>
                  {option.label}
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {tasks.length === 0 ? (
        <Empty>Nothing here. Tasks are created from a contact, order, or inquiry.</Empty>
      ) : (
        <ul className="grid gap-2">
          {tasks.map((task) => {
            const overdue = task.dueAt && !task.doneAt && task.dueAt < new Date();
            return (
              <li key={task.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-3 py-4">
                    <form action={setTaskDone.bind(null, task.id, !task.doneAt)}>
                      <button type="submit" aria-label={task.doneAt ? "Reopen task" : "Complete task"}>
                        <Checkbox checked={Boolean(task.doneAt)} className="pointer-events-none" />
                      </button>
                    </form>

                    <div className="grid flex-1">
                      <span className={`text-sm ${task.doneAt ? "text-muted-foreground line-through" : ""}`}>
                        {task.title}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {task.assignee.name}
                        {task.contact ? (
                          <> · <Link href={`/contacts/${task.contact.id}`} className="hover:underline">{task.contact.email}</Link></>
                        ) : null}
                        {task.order ? (
                          <> · <Link href={`/orders/${task.order.wooId}`} className="hover:underline">#{task.order.number}</Link></>
                        ) : null}
                        {task.inquiry ? (
                          <> · <Link href={`/inquiries/${task.inquiry.id}`} className="hover:underline">{task.inquiry.formName}</Link></>
                        ) : null}
                      </span>
                    </div>

                    {task.dueAt ? (
                      <Badge variant={overdue ? "destructive" : "outline"}>
                        {overdue ? "overdue " : "due "}
                        {formatDate(task.dueAt)}
                      </Badge>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
