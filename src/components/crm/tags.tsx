"use client";

import { useActionState, useRef } from "react";
import { X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addTag, removeTag, type TagState } from "@/actions/tags";

const INITIAL: TagState = { error: null };

export function TagEditor({
  contactId,
  tags,
}: {
  contactId: string;
  tags: { tagId: string; name: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(addTag.bind(null, contactId), INITIAL);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {tags.length === 0 ? (
          <span className="text-muted-foreground text-sm">No tags</span>
        ) : (
          tags.map((tag) => (
            <Badge key={tag.tagId} variant="secondary" className="gap-1 pr-1">
              {tag.name}
              <form action={removeTag.bind(null, contactId, tag.tagId)}>
                <button type="submit" aria-label={`Remove tag ${tag.name}`} className="cursor-pointer">
                  <X className="size-3" />
                </button>
              </form>
            </Badge>
          ))
        )}
      </div>

      <form
        ref={formRef}
        action={async (formData) => {
          await formAction(formData);
          formRef.current?.reset();
        }}
        className="flex gap-2"
      >
        <Input name="name" placeholder="Add a tag…" className="h-8" />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Add
        </Button>
      </form>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
