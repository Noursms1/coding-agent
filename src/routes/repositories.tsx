import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppNav } from "@/client/components/AppNav";
import { AppShell } from "@/client/components/AppShell";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Switch } from "@/client/components/ui/switch";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  getRepositories,
  setRepositoryEnabled,
} from "@/serverFunctions/repositories";

export const Route = createFileRoute("/repositories")({
  loader: () => getRepositories(),
  component: RepositoriesPage,
});

function RepositoriesPage() {
  const { isAdmin, list } = Route.useLoaderData();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(fullName: string, enabled: boolean) {
    setPending(fullName);
    try {
      await setRepositoryEnabled({ data: { fullName, enabled } });
      await router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The change wasn't saved.");
    } finally {
      setPending(null);
    }
  }

  return (
    <AppShell nav={<AppNav />}>
      <PageHeader
        title="Repositories"
        description={
          isAdmin ? "The agent works only in enabled repositories." : undefined
        }
      />
      {list.githubOff ? (
        <Alert data-testid="github-off">
          <AlertTitle>GitHub is off</AlertTitle>
          <AlertDescription>
            {isAdmin
              ? "Set up the GitHub feature in this app's setup on the Gateway, then the repositories it can reach appear here."
              : "An admin turns it on in the app's setup on the Gateway."}
          </AlertDescription>
        </Alert>
      ) : list.repos.length === 0 ? (
        <EmptyState
          title={
            isAdmin
              ? "GitHub gives access to no repositories"
              : "No repositories are enabled"
          }
          description={
            isAdmin
              ? "Grant the token access to a repository and it will appear here."
              : "An admin enables them here."
          }
        />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead>Default branch</TableHead>
                {isAdmin ? (
                  <TableHead className="text-right">Enabled</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.repos.map((repo) => (
                <TableRow key={repo.fullName} data-testid="repo-row">
                  <TableCell className="font-medium">{repo.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {repo.defaultBranch}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell className="text-right">
                      <Switch
                        aria-label={`Enable ${repo.fullName}`}
                        checked={repo.enabled}
                        disabled={pending === repo.fullName}
                        onCheckedChange={(checked) =>
                          toggle(repo.fullName, checked)
                        }
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </AppShell>
  );
}
