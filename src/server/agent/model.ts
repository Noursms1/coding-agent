import { env } from "cloudflare:workers";
import {
  aiBaseUrl,
  createGatewayFetch,
  gatewayRefusal,
} from "@every-app/sdk/server";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

/** A refusal or failure the session shows as its error. */
export class ModelError extends Error {}

/** One model turn through the Gateway, with the workspace's default model. */
export async function complete(
  orgId: string,
  messages: ChatMessage[],
  tools: ToolSpec[],
): Promise<Extract<ChatMessage, { role: "assistant" }>> {
  const fetchAi = createGatewayFetch({
    env,
    for: { background: true, organizationId: orgId },
  });
  const response = await fetchAi(`${aiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "default",
      messages,
      tools,
      tool_choice: "auto",
    }),
  });
  const refusal = await gatewayRefusal(response.clone());
  if (refusal) {
    throw new ModelError(
      refusal.code.endsWith("_not_configured")
        ? "No AI model is set up on the Gateway."
        : `The model call was refused (${refusal.code}).`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Model call failed with ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }
  const payload = (await response.json()) as {
    choices?: { message?: Extract<ChatMessage, { role: "assistant" }> }[];
  };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("The model returned no message.");
  return {
    role: "assistant",
    content: message.content ?? null,
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  };
}
