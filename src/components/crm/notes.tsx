"use client";

import { useActionState, useRef } from "react";
import { Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { addNote, deleteNote, type NoteState } from "@/actions/notes";
import type { CrmTarget } from "@/actions/targets";

export type NoteRow = {
  id: string;
  body: string;
  authorId: string;
  createdAt: Date;
  author: { name: string };
};

const INITIAL: NoteState = { error: null };

export function NoteList({
  notes,
  target,
  currentUserId,
}: {
  notes: NoteRow[];
  target: CrmTarget;
  currentUserId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(addNote.bind(null, target), INITIAL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
        <CardDescription>
          Internal only. Nothing here is sent to WooCommerce or seen by the customer.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          ref={formRef}
          action={async (formData) => {
            await formAction(formData);
            formRef.current?.reset();
          }}
          className="grid gap-2"
        >
          <Textarea name="body" placeholder="Add a note…" rows={3} required />
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Add note"}
            </Button>
          </div>
        </form>

        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No notes yet.</p>
        ) : (
          <ul className="grid gap-3">
            {notes.map((note) => (
              <li key={note.id} className="rounded-md border p-3">
                <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
                  <span>
                    {note.author.name} · {note.createdAt.toLocaleString()}
                  </span>
                  {note.authorId === currentUserId ? (
                    <form action={deleteNote.bind(null, note.id, target)}>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete note"
                        className="size-7"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </form>
                  ) : null}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
