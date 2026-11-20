import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
import { z } from "zod";
import { AppNav } from "@/client/components/AppNav";
import { AppShell } from "@/client/components/AppShell";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { RelativeTime } from "@/client/components/RelativeTime";
import { StatusBadge } from "@/client/components/StatusBadge";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { getSessions } from "@/serverFunctions/sessions";
import { SESSION_STATUSES, STATUS_LABELS } from "@/shared/sessions";

const search = z.object({ status: z.enum(SESSION_STATUSES).optional() });

export const Route = createFileRoute("/")({
  validateSearch: search,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: ({ deps }) => getSessions({ data: { status: deps.status } }),
  component: SessionsPage,
});

const FILTER_ITEMS = [
  { value: "all", label: "All statuses" },
  ...SESSION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
];

function SessionsPage() {
  const sessions = Route.useLoaderData();
  const { status } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  return (
    <AppShell nav={<AppNav />}>
      <PageHeader
        title="Sessions"
        actions={
          <Button
            data-testid="new-session"
            render={<Link to="/sessions/new" />}
            nativeButton={false}
          >
            <Plus />
            New session
          </Button>
        }
      />
      <div className="space-y-3">
        <Select
          items={FILTER_ITEMS}
          value={status ?? "all"}
          onValueChange={(value) =>
            navigate({
              search: {
                status:
                  value === "all"
                    ? undefined
                    : (value as (typeof SESSION_STATUSES)[number]),
              },
            })
          }
        >
          <SelectTrigger
            size="sm"
            data-testid="status-filter"
            aria-label="Status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sessions.length === 0 ? (
          status ? (
            <EmptyState
              kind="filtered"
              title={`No ${STATUS_LABELS[status].toLowerCase()} sessions`}
            />
          ) : (
            <EmptyState
              title="No sessions yet"
              description="Start one and the agent's progress will show here."
              media="rows"
            />
          )
        ) : (
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Pull request
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Updated
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id} data-testid="session-row">
                    <TableCell className="max-w-0 w-full">
                      <Link
                        to="/sessions/$id"
                        params={{ id: s.id }}
                        className="block truncate font-medium hover:underline"
                      >
                        {s.title}
                      </Link>
                      <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <span>{s.repoFullName}</span>
                        {s.mode === "ask" ? <span>· Question</span> : null}
                        {s.shared ? (
                          <span
                            className="inline-flex items-center gap-1"
                            title="Shared with the organization"
                          >
                            · <Users className="size-3" aria-label="Shared" />
                          </span>
                        ) : null}
                        {!s.mine && s.ownerEmail ? (
                          <span>· {s.ownerEmail}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {s.prUrl ? (
                        <a
                          href={s.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          #{s.prNumber}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right whitespace-nowrap text-muted-foreground sm:table-cell">
                      <RelativeTime iso={s.updatedAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>
    </AppShell>
  );
}
