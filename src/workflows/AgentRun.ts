import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  beginRun,
  failRun,
  finishRun,
  MAX_TURNS,
  pauseRun,
  safeTurn,
} from "@/server/agent/run";

interface Params {
  sessionId: string;
  orgId: string;
}

/** One agent run: model turns until the session waits on someone. */
export class AgentRun extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { sessionId } = event.payload;
    const started = await step.do("begin", () => beginRun(sessionId));
    if (!started) return;
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const result = await step.do(
          `turn ${turn}`,
          {
            retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
            timeout: "5 minutes",
          },
          () => safeTurn(sessionId),
        );
        if (result.error) {
          await step.do("fail", () => failRun(sessionId, result.error!));
          return;
        }
        if (result.done) {
          const settled = await step.do(`finish ${turn}`, () =>
            finishRun(sessionId, Boolean(result.asked)),
          );
          if (settled) return;
        }
      }
      await step.do("pause", () => pauseRun(sessionId));
    } catch (error) {
      console.error(error);
      await step.do("fail", () =>
        failRun(sessionId, "The agent hit an error and stopped."),
      );
    }
  }
}
