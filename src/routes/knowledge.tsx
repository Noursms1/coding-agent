import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AppNav } from "@/client/components/AppNav";
import { AppShell } from "@/client/components/AppShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { RelativeTime } from "@/client/components/RelativeTime";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";
import {
  createNote,
  deleteNote,
  getNotes,
  updateNote,
} from "@/serverFunctions/notes";

export const Route = createFileRoute("/knowledge")({
  loader: () => getNotes(),
  component: KnowledgePage,
});

type Note = Awaited<ReturnType<typeof getNotes>>["notes"][number];
type Repo = Awaited<ReturnType<typeof getNotes>>["repos"][number];

function KnowledgePage() {
  const { notes, repos } = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<Note | "new" | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);
  const [pending, setPending] = useState(false);

  async function remove(note: Note) {
    setPending(true);
    try {
      await deleteNote({ data: { id: note.id } });
      setDeleting(null);
      await router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The note wasn't deleted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell nav={<AppNav />}>
      <PageHeader
        title="Knowledge"
        description="The agent reads these notes at the start of every session in their repositories."
        actions={
          <Button data-testid="new-note" onClick={() => setEditing("new")}>
            <Plus />
            New note
          </Button>
        }
      />
      {notes.length === 0 ? (
        <EmptyState
          title="No notes yet"
          description="Write down conventions, commands and context the agent should know."
        />
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id}>
              <Card data-testid="note-row">
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h2 className="font-medium">{note.title}</h2>
                      <p className="text-sm text-muted-foreground">
                        Use when: {note.trigger}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="outline">
                        {note.repoFullName ?? "All repositories"}
                      </Badge>
                      {note.canEdit ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${note.title}`}
                            onClick={() => setEditing(note)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${note.title}`}
                            onClick={() => setDeleting(note)}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {note.authorEmail ?? "A member"} ·{" "}
                    <RelativeTime iso={note.updatedAt} />
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <NoteDialog
          note={editing === "new" ? null : editing}
          repos={repos}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await router.invalidate();
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete “${deleting.title}”?`}
          confirmLabel="Delete note"
          destructive
          pending={pending}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        >
          Sessions that start after this won't load it.
        </ConfirmDialog>
      ) : null}
    </AppShell>
  );
}

const ALL = "all";

function NoteDialog({
  note,
  repos,
  onClose,
  onSaved,
}: {
  note: Note | null;
  repos: Repo[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [trigger, setTrigger] = useState(note?.trigger ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [repoId, setRepoId] = useState<string>(note?.repoId ?? ALL);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [
    { value: ALL, label: "All repositories" },
    ...repos.map((r) => ({ value: r.id, label: r.fullName })),
    // A note pinned to a repository that has since been turned off keeps its pin.
    ...(note?.repoId && !repos.some((r) => r.id === note.repoId)
      ? [
          {
            value: note.repoId,
            label: note.repoFullName ?? "Another repository",
          },
        ]
      : []),
  ];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = {
      title,
      trigger,
      body,
      repoId: repoId === ALL ? null : repoId,
    };
    try {
      if (note) await updateNote({ data: { id: note.id, ...data } });
      else await createNote({ data });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The note wasn't saved.");
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : "New note"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-trigger">When to use</Label>
            <Input
              id="note-trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-body">Note</Label>
            <Textarea
              id="note-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-repo">Repository</Label>
            <Select
              items={items}
              value={repoId}
              onValueChange={(value) => setRepoId(String(value ?? ALL))}
            >
              <SelectTrigger id="note-repo" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" data-testid="save-note" disabled={pending}>
              {pending ? <Spinner /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
