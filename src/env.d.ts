/// <reference types="vite/client" />

// The bindings come from `cf workers types` (.cloudflare/types). Secrets are
// optional until set.
declare namespace Cloudflare {
  interface Env {
    GITHUB_WEBHOOK_SECRET?: string;
  }
}
