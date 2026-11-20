import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppNav } from "@/client/components/AppNav";
import { AppShell } from "@/client/components/AppShell";
import { BackLink, PageHeader } from "@/client/components/PageHeader";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/client/components/ui/toggle-group";
import { Spinner } from "@/client/components/ui/spinner";
import {
  createSession,
  getNewSessionOptions,
} from "@/serverFunctions/sessions";

export const Route = createFileRoute("/sessions/new")({
  loader: () => getNewSessionOptions(),
  component: NewSessionPage,
});

type Mode = "build" | "ask";

function NewSessionPage() {
  const { githubOff, repos } = Route.useLoaderData();
  const navigate = useNavigate();
  const [repoId, setRepoId] = useState<string | null>(
    repos.length === 1 ? repos[0]!.id : null,
  );
  const [baseBranch, setBaseBranch] = useState(
    repos.length === 1 ? repos[0]!.defaultBranch : "",
  );
  const [mode, setMode] = useState<Mode>("build");
  const [task, setTask] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = repos.map((r) => ({ value: r.id, label: r.fullName }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!repoId) return setError("Pick a repository.");
    setPending(true);
    setError(null);
    try {
      const { id } = await createSession({
        data: { repoId, baseBranch, mode, task },
      });
      await navigate({ to: "/sessions/$id", params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The session couldn't start.");
      setPending(false);
    }
  }

  return (
    <AppShell nav={<AppNav />}>
      <PageHeader
        title="New session"
        backLink={<BackLink to="/">Sessions</BackLink>}
      />
      {githubOff ? (
        <Alert data-testid="github-off">
          <AlertTitle>GitHub is off</AlertTitle>
          <AlertDescription>
            An admin turns it on in the app's setup on the Gateway.
          </AlertDescription>
        </Alert>
      ) : repos.length === 0 ? (
        <Alert>
          <AlertTitle>No repositories are enabled</AlertTitle>
          <AlertDescription>
            An admin enables them on the{" "}
            <Link to="/repositories" className="underline">
              Repositories
            </Link>{" "}
            page.
          </AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="repo">Repository</Label>
            <Select
              items={items}
              value={repoId}
              onValueChange={(value) => {
                const repo = repos.find((r) => r.id === value);
                setRepoId(repo?.id ?? null);
                if (repo) setBaseBranch(repo.defaultBranch);
              }}
              disabled={githubOff}
            >
              <SelectTrigger
                id="repo"
                data-testid="repo-select"
                className="w-full"
              >
                <SelectValue placeholder="Choose a repository" />
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
          <div className="space-y-2">
            <Label htmlFor="base-branch">Base branch</Label>
            <Input
              id="base-branch"
              data-testid="base-branch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              required
              disabled={githubOff}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Mode</Label>
          <ToggleGroup
            variant="outline"
            value={[mode]}
            onValueChange={(next) => {
              if (next[0] === "build" || next[0] === "ask") setMode(next[0]);
            }}
          >
            <ToggleGroupItem value="build" data-testid="mode-build">
              Build changes
            </ToggleGroupItem>
            <ToggleGroupItem value="ask" data-testid="mode-ask">
              Ask a question
            </ToggleGroupItem>
          </ToggleGroup>
          {mode === "build" ? (
            <p className="text-sm text-muted-foreground">
              The agent edits code on its own branch and opens a pull request.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="task">{mode === "build" ? "Task" : "Question"}</Label>
          <Textarea
            id="task"
            data-testid="task-input"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={6}
            required
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="submit"
          data-testid="start-session"
          disabled={githubOff || repos.length === 0 || pending}
        >
          {pending ? <Spinner /> : null}
          Start session
        </Button>
      </form>
    </AppShell>
  );
}
