import { createFileRoute } from "@tanstack/react-router";
import { handleGitHubWebhook } from "@/server/webhooks";

// Public (everyapp.config.ts): GitHub posts check results and reviews here.
export const Route = createFileRoute("/github/webhooks")({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) => handleGitHubWebhook(request),
    },
  },
});
