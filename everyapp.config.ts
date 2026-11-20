import { defineEveryApp } from "@every-app/sdk";

export default defineEveryApp({
  id: "coding-agent",
  name: "Coding Agent",
  description:
    "Hand a coding task to an AI agent that works in your GitHub repositories, opens a pull request and fixes it until its checks pass.",
  icon: "/icon.svg",
  access: "everyone",
  resources: {
    d1: ["DB"],
    // One instance per agent run: it works until the session waits on someone.
    workflows: [{ name: "AGENT_RUN", className: "AgentRun" }],
  },
  // GitHub posts check results and review comments here; the route checks
  // the signature itself.
  public: [{ path: "/github/webhooks", methods: ["POST"] }],
  ai: {
    chat: {
      why: "The agent plans, reads code, writes changes and answers questions with the workspace's default model.",
    },
  },
  capabilities: {
    github: {
      access: "write",
      why: "Lists repositories, reads their files, pushes the agent's branches and opens pull requests.",
      docs: "https://github.com/settings/personal-access-tokens/new",
    },
  },
  features: {
    github: {
      name: "GitHub",
      why: "Lets the agent work in your repositories and react to their checks and reviews.",
      steps: [
        "Create a fine-grained token for the repositories the agent may use: https://github.com/settings/personal-access-tokens/new. Permissions: Contents, Pull requests → Read and write; Checks, Metadata → Read.",
        "Add a webhook to each repository or the organization: Payload URL {appUrl}/github/webhooks, content type application/json, events Check runs, Check suites, Pull request reviews, Pull request review comments and Issue comments.",
      ],
      capabilities: ["github"],
      secrets: [
        {
          name: "GITHUB_WEBHOOK_SECRET",
          generate: true,
          how: "Paste this into the webhook's Secret field",
        },
      ],
    },
  },
});
