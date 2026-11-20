import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  BookOpen,
  CircleAlert,
  CircleCheck,
  CircleX,
  GitPullRequest,
  ListChecks,
  MessageSquareText,
  Square,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppNav } from "@/client/components/AppNav";
import { AppShell } from "@/client/components/AppShell";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { BackLink, PageHeader } from "@/client/components/PageHeader";
import { RelativeTime } from "@/client/components/RelativeTime";
import { StatusBadge } from "@/client/components/StatusBadge";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Label } from "@/client/components/ui/label";
import { Spinner } from "@/client/components/ui/spinner";
import { Switch } from "@/client/components/ui/switch";
import { Textarea } from "@/client/components/ui/textarea";
import {
  getSession,
  sendMessage,
  setSessionVisibility,
  stopSession,
} from "@/serverFunctions/sessions";
import { ACTIVE_STATUSES, CHAT_KINDS } from "@/shared/sessions";

export const Route = createFileRoute("/sessions/$id")({
  params: {
    parse: (p) => ({ id: p.id }),
  },
  loader: ({ params }) =>
    /^[0-9a-f-]{36}$/.test(params.id)
      ? getSession({ data: { id: params.id } })
      : null,
  component: SessionPage,
});

type Data = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type Event = Data["events"][number];

function SessionPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const active = data ? ACTIVE_STATUSES.includes(data.session.status) : false;

  // New steps, replies and check results arrive in the background.
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(
      () => void router.invalidate(),
      active ? 1500 : 4000,
    );
    return () => clearInterval(timer);
  }, [router, active, data]);

  if (!data) {
    return (
      <AppShell nav={<AppNav />}>
        <PageHeader
          title="Session"
          backLink={<BackLink to="/">Sessions</BackLink>}
        />
        <div data-testid="session-not-found">
          <EmptyState
            kind="filtered"
            title="Session not found"
            description="It doesn't exist or hasn't been shared with you."
          />
        </div>
      </AppShell>
    );
  }
  const { session, events } = data;
  const chat = events.filter((e) => CHAT_KINDS.includes(e.kind));
  const timeline = events.filter((e) => !CHAT_KINDS.includes(e.kind));

  return (
    <AppShell nav={<AppNav />}>
      <PageHeader
        backLink={<BackLink to="/">Sessions</BackLink>}
        title={session.title}
        description={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={session.status} testId="session-status" />
            <span>{session.repoFullName}</span>
            <span>
              {session.mode === "build"
                ? `${session.baseBranch} ← ${session.branch}`
                : "Question"}
            </span>
            {session.prUrl ? (
              <a
                data-testid="pr-link"
                href={session.prUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Pull request #{session.prNumber}
              </a>
            ) : null}
            {!data.isOwner && session.ownerEmail ? (
              <span>Started by {session.ownerEmail}</span>
            ) : null}
          </div>
        }
        actions={<SessionActions data={data} />}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Chat
          sessionId={session.id}
          events={chat}
          stopped={session.status === "stopped"}
          working={active}
        />
        <Timeline events={timeline} />
      </div>
    </AppShell>
  );
}

function SessionActions({ data }: { data: Data }) {
  const router = useRouter();
  const { session } = data;
  const shared = session.visibility === "organization";
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  // The owner shares; the owner or an admin makes it private again.
  const canToggle = shared ? data.canManage : data.isOwner;

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    try {
      await action();
      await router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Switch
          id="share"
          data-testid="share-toggle"
          checked={shared}
          disabled={!canToggle || pending}
          onCheckedChange={(checked) =>
            run(() =>
              setSessionVisibility({
                data: {
                  id: session.id,
                  visibility: checked ? "organization" : "private",
                },
              }),
            )
          }
        />
        <Label htmlFor="share">Shared with the organization</Label>
      </div>
      {data.canManage && session.status !== "stopped" ? (
        <Button
          variant="outline"
          data-testid="stop-session"
          onClick={() => setConfirming(true)}
        >
          <Square />
          Stop
        </Button>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title="Stop this session?"
          confirmLabel="Stop session"
          destructive
          pending={pending}
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            run(async () => {
              await stopSession({ data: { id: session.id } });
              setConfirming(false);
            })
          }
        >
          The agent stops for good. Its branch and pull request stay on GitHub.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function Chat({
  sessionId,
  events,
  stopped,
  working,
}: {
  sessionId: string;
  events: Event[];
  stopped: boolean;
  working: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setPending(true);
    try {
      await sendMessage({ data: { id: sessionId, body } });
      setBody("");
      await router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The message wasn't sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol
          data-testid="chat"
          className="max-h-[32rem] space-y-3 overflow-y-auto"
        >
          {events.map((e) => (
            <li key={e.id} data-testid="chat-message" className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground">
                  {e.kind === "agent" ? "Agent" : (e.authorEmail ?? "Member")}
                </span>
                <RelativeTime iso={e.createdAt} />
              </div>
              <p
                className={
                  e.kind === "agent"
                    ? "rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
                    : "rounded-lg border border-border px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {e.body}
              </p>
            </li>
          ))}
          {working ? (
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Working
            </li>
          ) : null}
          <div ref={end} />
        </ol>
        {stopped ? null : (
          <form onSubmit={send} className="space-y-2">
            <Textarea
              data-testid="message-input"
              aria-label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e);
              }}
              rows={3}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                data-testid="send-message"
                disabled={pending || !body.trim()}
              >
                {pending ? <Spinner /> : null}
                Send
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

const ICONS: Record<string, LucideIcon> = {
  plan: ListChecks,
  knowledge: BookOpen,
  step: Wrench,
  review: MessageSquareText,
  error: CircleAlert,
  status: Square,
};

function iconFor(e: Event): LucideIcon {
  if (e.kind === "checks") return e.data?.passed ? CircleCheck : CircleX;
  if (e.kind === "step" && e.body.startsWith("Opened pull request"))
    return GitPullRequest;
  return ICONS[e.kind] ?? Wrench;
}

function Timeline({ events }: { events: Event[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ol
          data-testid="timeline"
          className="max-h-[40rem] space-y-3 overflow-y-auto"
        >
          {events.length === 0 ? (
            <li className="text-sm text-muted-foreground">Nothing yet.</li>
          ) : null}
          {events.map((e) => {
            const Icon = iconFor(e);
            const steps = e.kind === "plan" ? e.data?.steps : undefined;
            const files = e.data?.files;
            const tone =
              e.kind === "error" || (e.kind === "checks" && !e.data?.passed)
                ? "text-destructive"
                : e.kind === "checks"
                  ? "text-success"
                  : "text-muted-foreground";
            return (
              <li
                key={e.id}
                data-testid="timeline-item"
                className="flex gap-2.5 text-sm"
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${tone}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="break-words">
                    {e.kind === "status" && e.authorEmail
                      ? `${e.body} by ${e.authorEmail}`
                      : e.body}
                  </p>
                  {steps ? (
                    <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                      {steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  ) : null}
                  {e.kind === "step" && files ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {files.join(", ")}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
