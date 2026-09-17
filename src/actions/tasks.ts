"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { resolveContactId, targetPaths, type CrmTarget } from "@/actions/targets";

export type TaskState = { error: string | null };

const schema = z.object({
  title: z.string().trim().min(1, { message: "A task needs a title" }).max(500),
  assigneeId: z.string().min(1, { message: "Pick who it is for" }),
  dueAt: z.string().optional(),
});

export async function addTask(
  target: CrmTarget,
  _prev: TaskState,
  formData: FormData,
): Promise<TaskState> {
  const user = await requireUser();

  const parsed = schema.safeParse({
    title: formData.get("title"),
    assigneeId: formData.get("assigneeId"),
    dueAt: formData.get("dueAt"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  await prisma.task.create({
    data: {
      ...target,
      title: parsed.data.title,
      assigneeId: parsed.data.assigneeId,
      createdById: user.id,
      dueAt: parsed.data.dueAt ? new Date(`${parsed.data.dueAt}T12:00:00Z`) : null,
    },
  });

  for (const path of targetPaths(target)) {
    revalidatePath(path);
  }

  return { error: null };
}

export async function setTaskDone(taskId: string, done: boolean): Promise<void> {
  const user = await requireUser();

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { doneAt: done ? new Date() : null },
  });

  const contactId = await resolveContactId({
    contactId: task.contactId ?? undefined,
    orderId: task.orderId ?? undefined,
    inquiryId: task.inquiryId ?? undefined,
  });

  if (done && contactId) {
    await prisma.activity.create({
      data: {
        contactId,
        type: "TASK_DONE",
        refId: task.id,
        summary: `${user.name} completed "${task.title}"`,
        occurredAt: new Date(),
      },
    });
  }

  if (!done) {
    await prisma.activity.deleteMany({ where: { type: "TASK_DONE", refId: taskId } });
  }

  for (const path of targetPaths({
    contactId: task.contactId ?? undefined,
    orderId: task.orderId ?? undefined,
    inquiryId: task.inquiryId ?? undefined,
  })) {
    revalidatePath(path);
  }
}
