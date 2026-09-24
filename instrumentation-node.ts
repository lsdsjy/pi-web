import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";
import { stripHostAnthropicCredentials } from "@/lib/host-provider-env";

export function registerNodeInstrumentation(): void {
  // Runs before the first request, so every ModelRuntime built by this process
  // sees a clean environment. The host shell exports these for its own tools;
  // pi would otherwise treat them as its built-in provider's credentials and
  // list Anthropic models that fail against api.anthropic.com. See
  // lib/host-provider-env.ts for what stays supported.
  stripHostAnthropicCredentials();

  configureHttpDispatcher();

  // In production Next 16 answers SIGINT/SIGTERM with server.close() and waits
  // for every connection to end, without a timeout. SSE streams only end when
  // the client disconnects, so close them here or the process never exits.
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
