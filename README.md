# Coding Agent

Hand a coding task or a question about your code to an AI agent. It works in your GitHub repositories, opens a pull request and keeps fixing it until the checks pass and reviewers are satisfied.

Inspired by cognition.com

Built with [oss.new](https://oss.new) for [EveryApp](https://github.com/every-app/every-app).

## Features

- Admins choose which GitHub repositories the agent may work in.
- Start a session on a repository and branch, to build a change or ask a question, and follow its plan, steps and chat live.
- The agent waits on the pull request's checks, fixes failures up to five times and answers review comments.
- Write team notes, for every repository or one, that the agent loads at the start of each session.
- Share a session with the organization so others can follow it and join the chat.

Left out: accounts and sign-in, which your Gateway handles; a shell, browser or editor for the agent (it relies on your CI instead); desktop and terminal clients; chat-tool and issue-tracker integrations; scheduled sessions; billing and enterprise administration.

## Setup

Install from the release with `everyapp install <release URL>`, or from a checkout: `pnpm install`, then `pnpm run deploy`. Locally, `pnpm dev` runs it, `pnpm test` runs the unit tests, and `node checks/<suite>.mjs` runs the release checks through the oss.new runtime.

Then `pnpm everyapp configure coding-agent` walks what it needs:

- **AI model**: the workspace's default model on the Gateway (for example an OpenRouter key). Required.
- **GitHub** (optional feature): the Gateway's `github` provider holds a fine-grained token with Contents and Pull requests read and write, and Checks and Metadata read, on the repositories the agent may use. `GITHUB_WEBHOOK_SECRET` is generated for you; paste it into a webhook on those repositories (or the organization) pointing at `<app URL>/github/webhooks`, content type JSON, with the Check runs, Check suites, Pull request reviews, Pull request review comments and Issue comments events.

## Limitations

- The agent can't run code; it checks its work through the repository's CI. In a repository with no checks, a session stays in Awaiting checks once its pull request opens.
- Code search uses GitHub's search, which covers only the default branch.
- Pull requests are opened with the token's account, so they show that account as the author.
- Real GitHub and model calls weren't part of the local checks; those ran against a local stand-in for the Gateway.
