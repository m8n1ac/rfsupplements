"use client";

import { useActionState, useRef } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addTask, setTaskDone, type TaskState } from "@/actions/tasks";
import type { CrmTarget } from "@/actions/targets";

export type TaskRow = {
  id: string;
  title: string;
  dueAt: Date | null;
  doneAt: Date | null;
  assignee: { name: string };
};

const INITIAL: TaskState = { error: null };

export function TaskList({
  tasks,
  target,
  staff,
}: {
  tasks: TaskRow[];
  target: CrmTarget;
  staff: { id: string; name: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(addTask.bind(null, target), INITIAL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          ref={formRef}
          action={async (formData) => {
            await formAction(formData);
            formRef.current?.reset();
          }}
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="title">Task</Label>
            <Input id="title" name="title" placeholder="Follow up…" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assigneeId">For</Label>
            <select
              id="assigneeId"
              name="assigneeId"
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              required
            >
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dueAt">Due</Label>
            <Input id="dueAt" name="dueAt" type="date" />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
          {state.error ? (
            <Alert variant="destructive" className="sm:col-span-4">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
        </form>

        {tasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tasks yet.</p>
        ) : (
          <ul className="grid gap-2">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 rounded-md border p-3">
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
                    {task.dueAt ? ` · due ${task.dueAt.toLocaleDateString()}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
