// A local stand-in for the Gateway's AI proxy and its GitHub capability, so the
// agent loop can run end to end in the packaged runtime. Third-party fake only:
// the app under test keeps all its own state in D1.
import { createHmac } from "node:crypto";

export const WEBHOOK_SECRET = "local-test-webhook-secret";
const NAME = "fake-gateway";

const SOURCE = String.raw`
const enc = (s) => btoa(unescape(encodeURIComponent(s)));
const files = {
  "acme/storefront": {
    "README.md": "# Storefront\nThe web shop.\n",
    "AGENTS.md": "Run the tests with pnpm test before you push.\n",
    "src/cart.ts": "export function total(items, discount) {\n  const sum = items.reduce((a, i) => a + i.price * i.qty, 0);\n  return sum - sum * discount;\n}\n",
    "src/cart.test.ts": "import { total } from './cart';\n",
  },
  "acme/billing-service": { "README.md": "# Billing\n" },
};
const repos = [
  { id: 101, name: "storefront", full_name: "acme/storefront", default_branch: "main", private: true },
  { id: 102, name: "billing-service", full_name: "acme/billing-service", default_branch: "trunk", private: true },
];
const branches = {}; // "repo#branch" -> { sha, files, commits }
const commits = {}; // sha -> { repo, branch, index, tree }
const trees = {}; // sha -> files
const pulls = [];
let seq = 0;

function branchState(repo, name) {
  const key = repo + "#" + name;
  if (!branches[key] && files[repo] && (name === "main" || name === "trunk")) {
    branches[key] = { sha: "base-" + repo.replace("/", "-"), files: { ...files[repo] }, commits: 0 };
    trees["tree-base-" + repo.replace("/", "-")] = branches[key].files;
    commits[branches[key].sha] = { repo, branch: name, index: 0, tree: "tree-base-" + repo.replace("/", "-") };
  }
  return branches[key];
}

function github(method, path, search, body) {
  let m;
  if (method === "GET" && path === "/user/repos") return [200, repos];
  if ((m = path.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/))) {
    const repo = m[1], rest = m[2] ?? "";
    const meta = repos.find((r) => r.full_name === repo);
    if (!meta) return [404, { message: "Not Found" }];
    if (method === "GET" && rest === "") return [200, meta];
    if (method === "GET" && (m = rest.match(/^\/git\/trees\/(.+)$/))) {
      const b = branchState(repo, decodeURIComponent(m[1]));
      if (!b) return [404, { message: "Not Found" }];
      return [200, { tree: Object.keys(b.files).map((p) => ({ path: p, type: "blob", size: b.files[p].length })), truncated: false }];
    }
    if (method === "GET" && (m = rest.match(/^\/contents\/(.+)$/))) {
      const b = branchState(repo, search.get("ref") || meta.default_branch);
      const p = decodeURIComponent(m[1]);
      if (!b || !(p in b.files)) return [404, { message: "Not Found" }];
      return [200, { type: "file", path: p, encoding: "base64", content: enc(b.files[p]) }];
    }
    if (method === "GET" && (m = rest.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const b = branchState(repo, decodeURIComponent(m[1]));
      return b ? [200, { object: { sha: b.sha } }] : [404, { message: "Not Found" }];
    }
    if (method === "POST" && rest === "/git/refs") {
      const name = body.ref.replace("refs/heads/", "");
      const from = commits[body.sha];
      if (!from) return [422, { message: "bad sha" }];
      branches[repo + "#" + name] = { sha: body.sha, files: { ...trees[from.tree] }, commits: 0 };
      return [201, { ref: body.ref, object: { sha: body.sha } }];
    }
    if (method === "GET" && (m = rest.match(/^\/git\/commits\/(.+)$/))) {
      const c = commits[m[1]];
      return c ? [200, { sha: m[1], tree: { sha: c.tree } }] : [404, { message: "Not Found" }];
    }
    if (method === "POST" && rest === "/git/trees") {
      const next = { ...(trees[body.base_tree] ?? {}) };
      for (const entry of body.tree) {
        if (entry.sha === null) delete next[entry.path];
        else next[entry.path] = entry.content;
      }
      const sha = "tree-" + ++seq;
      trees[sha] = next;
      return [201, { sha }];
    }
    if (method === "POST" && rest === "/git/commits") {
      const sha = "commit-" + ++seq;
      commits[sha] = { repo, tree: body.tree, message: body.message, parents: body.parents };
      return [201, { sha }];
    }
    if (method === "PATCH" && (m = rest.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const b = branches[repo + "#" + decodeURIComponent(m[1])];
      const c = commits[body.sha];
      if (!b || !c) return [422, { message: "bad ref" }];
      if (decodeURIComponent(m[1]) === meta.default_branch) return [422, { message: "protected" }];
      b.sha = body.sha; b.files = { ...trees[c.tree] }; b.commits += 1;
      c.branch = decodeURIComponent(m[1]); c.index = b.commits;
      return [200, { object: { sha: body.sha } }];
    }
    if (method === "POST" && rest === "/pulls") {
      const number = 40 + pulls.length + 1;
      pulls.push({ repo, number, ...body });
      return [201, { number, html_url: "https://github.com/" + repo + "/pull/" + number }];
    }
    if (method === "GET" && (m = rest.match(/^\/commits\/([^/]+)\/check-runs$/))) {
      const c = commits[m[1]];
      if (!c) return [404, { message: "Not Found" }];
      // The branch's first commit fails its tests; later commits pass.
      const failed = c.index === 1;
      return [200, { total_count: 2, check_runs: [
        { name: "lint", status: "completed", conclusion: "success", output: { title: "Lint", summary: "No problems" } },
        { name: "test", status: "completed", conclusion: failed ? "failure" : "success",
          output: { title: failed ? "1 test failed" : "All tests passed", summary: failed ? "cart.test.ts: total([{price: 19.99, qty: 3}], 0.1) expected 53.97, received 53.973" : "12 passed" } },
      ] }];
    }
  }
  if (method === "GET" && path === "/search/code") {
    const q = (search.get("q") || "").split(" ")[0].toLowerCase();
    const repo = ((search.get("q") || "").match(/repo:(\S+)/) || [])[1];
    const b = repo && branchState(repo, repos.find((r) => r.full_name === repo)?.default_branch);
    const items = b ? Object.keys(b.files).filter((p) => b.files[p].toLowerCase().includes(q)).map((p) => ({ path: p })) : [];
    return [200, { total_count: items.length, items }];
  }
  return [404, { message: "Not Found" }];
}

// The model: a fixed script keyed on the conversation so far.
function call(id, name, args) { return { id: "call_" + id + "_" + name, type: "function", function: { name, arguments: JSON.stringify(args) } }; }
const FIXED = "export function total(items, discount) {\n  const sum = items.reduce((a, i) => a + i.price * i.qty, 0);\n  return Math.round((sum - sum * discount) * 100) / 100;\n}\n";
function model(body) {
  const msgs = body.messages;
  const system = msgs.find((m) => m.role === "system")?.content ?? "";
  const ask = /Mode: ask/.test(system);
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") { lastUser = i; break; }
  const user = String(msgs[lastUser]?.content ?? "");
  const turn = msgs.slice(lastUser + 1).filter((m) => m.role === "assistant").length;
  const firstTask = msgs.filter((m) => m.role === "user").length === 1;
  const say = (content) => ({ role: "assistant", content });
  const tools = (...calls) => ({ role: "assistant", content: null, tool_calls: calls });
  if (ask) {
    if (turn === 0) return tools(call(1, "search_code", { query: "discount" }), call(2, "read_file", { path: "src/cart.ts" }));
    return say("Discounts are applied in total() in src/cart.ts: it subtracts sum * discount from the cart sum and does not round the result.");
  }
  if (firstTask && /ask me first/i.test(user)) {
    return tools(call(0, "ask_user", { question: "Should totals round half up to whole cents?" }));
  }
  if (/^CI checks failed/.test(user)) {
    if (turn === 0) return tools(call(3, "read_file", { path: "src/cart.ts" }));
    if (turn === 1) return tools(call(4, "write_file", { path: "src/cart.ts", content: FIXED }), call(5, "commit", { message: "Round cart totals to cents" }));
    return say("Pushed a fix that rounds totals to cents.");
  }
  if (/^Review on the pull request/.test(user)) {
    if (turn === 0) return tools(call(6, "write_file", { path: "src/cart.ts", content: "// Totals are rounded to cents.\n" + FIXED }), call(7, "commit", { message: "Document rounding" }));
    return say("Added a comment explaining the rounding, as the review asked.");
  }
  const start = firstTask || /round half up/i.test(user) || /yes/i.test(user);
  const hasPr = msgs.slice(0, lastUser).some((m) => m.tool_calls?.some((c) => c.function.name === "open_pull_request"));
  if (start && !hasPr) {
    if (turn === 0) return tools(call(10, "post_plan", { steps: ["Read the cart total code", "Round the discounted total to cents", "Open a pull request"] }), call(11, "list_files", {}));
    if (turn === 1) return tools(call(12, "read_file", { path: "src/cart.ts" }), call(13, "search_code", { query: "discount" }));
    if (turn === 2) return tools(call(14, "write_file", { path: "src/cart.ts", content: FIXED.replace("Math.round((sum - sum * discount) * 100) / 100", "sum - sum * discount") + "// TODO rounding\n" }), call(15, "commit", { message: "Apply discount to cart total" }));
    if (turn === 3) return tools(call(16, "open_pull_request", { title: "Fix discount rounding in cart totals", body: "Rounds the discounted total." }));
    return say("I opened a pull request with the change. I will watch its checks.");
  }
  return say("Understood. The pull request stays as it is unless you ask for more.");
}

const calls = [];
export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/__calls") return Response.json(calls);
  const text = request.method === "GET" ? null : await request.text();
  calls.push({ method: request.method, path: url.pathname + url.search });
  if (url.pathname === "/api/ai/default/v1/chat/completions") {
    const message = model(JSON.parse(text));
    return Response.json({ id: "fake", object: "chat.completion", model: "fake-model",
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }
  const prefix = "/api/integrations/github/api.github.com";
  if (url.pathname.startsWith(prefix)) {
    const [status, payload] = github(request.method, url.pathname.slice(prefix.length), url.searchParams, text ? JSON.parse(text) : null);
    return Response.json(payload, { status });
  }
  const code = "integration_not_configured";
  return Response.json({ error: "Service Unavailable", code, message: "Not configured here." }, { status: 503, headers: { "x-everyapp-error": code } });
} };
`;

/** startRuntime options that route the app's Gateway calls to the fake. */
export function withFakeGateway(extra = {}) {
  return {
    bindings: {
      GITHUB_WEBHOOK_SECRET: { type: "text", value: WEBHOOK_SECRET },
      EVERY_APP_GATEWAY: { type: "worker", worker: NAME },
      ...extra,
    },
    workers: [
      {
        config: {
          name: NAME,
          compatibilityDate: "2025-09-01",
          manifest: {
            mainModule: "fake.mjs",
            modules: { "fake.mjs": { type: "esm", contents: SOURCE } },
          },
        },
      },
    ],
  };
}

/** A signed GitHub webhook delivery, as GitHub sends one. */
export function webhook(event, payload, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  const signature =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signature,
      "x-github-delivery": crypto.randomUUID(),
    },
    body,
  };
}

/** Polls fn until it returns a truthy value. */
export async function until(fn, { timeout = 30000, interval = 300 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end)
      throw new Error("Timed out waiting: " + fn.toString().slice(0, 200));
    await new Promise((r) => setTimeout(r, interval));
  }
}
