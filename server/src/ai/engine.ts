import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import { getApiKey, isMockMode, loadConfig } from "../config.js";
import {
  AGENT_TOOLS,
  READ_TOOLS,
  describeToolCall,
  executeTool,
  type FileEdit,
} from "../tools.js";
import { AGENT_SYSTEM, CHAT_SYSTEM } from "./prompts.js";
import { mockTurn } from "./mock.js";

/** Events streamed to the client over SSE. */
export type AiEvent =
  | { type: "run_start"; runId: string; mode: "chat" | "agent"; model: string; mock: boolean }
  | { type: "text"; text: string }
  | { type: "thinking" }
  | { type: "tool_start"; id: string; name: string; label: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean; edit?: FileEdit }
  | { type: "done"; stopReason: string; usage?: { input: number; output: number } }
  | { type: "error"; message: string };

export type Emit = (ev: AiEvent) => void;

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_ITERATIONS = 40;

interface TurnResult {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage?: { input: number; output: number };
}

/** One model turn: stream text deltas out, return the full assistant message. */
async function realTurn(
  client: Anthropic,
  model: string,
  system: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  emit: Emit,
  signal: AbortSignal,
): Promise<TurnResult> {
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 32_000,
      system,
      messages,
      tools,
      thinking: { type: "adaptive" },
    },
    { signal },
  );

  stream.on("text", (delta) => emit({ type: "text", text: delta }));
  stream.on("streamEvent", (ev) => {
    if (ev.type === "content_block_start" && ev.content_block.type === "thinking") {
      emit({ type: "thinking" });
    }
  });

  const message = await stream.finalMessage();
  return {
    content: message.content,
    stopReason: message.stop_reason,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
    },
  };
}

/**
 * The agent loop: stream a turn, execute any requested tools, feed results
 * back, repeat until the model stops calling tools.
 */
export async function runAi(
  mode: "chat" | "agent",
  history: HistoryMessage[],
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const runId = crypto.randomUUID().slice(0, 8);
  const config = loadConfig();
  const model = mode === "agent" ? config.models.agent : config.models.chat;
  const tools = mode === "agent" ? AGENT_TOOLS : READ_TOOLS;
  const system = mode === "agent" ? AGENT_SYSTEM() : CHAT_SYSTEM();
  const mock = isMockMode();

  emit({ type: "run_start", runId, mode, model: mock ? "mock" : model, mock });

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let client: Anthropic | null = null;
  if (!mock) {
    client = new Anthropic({ apiKey: getApiKey() });
  }

  let totalUsage = { input: 0, output: 0 };

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (signal.aborted) break;

      const turn: TurnResult = mock
        ? await mockTurn(mode, messages, emit)
        : await realTurn(client!, model, system, messages, tools, emit, signal);

      if (turn.usage) {
        totalUsage.input += turn.usage.input;
        totalUsage.output += turn.usage.output;
      }

      if (turn.stopReason !== "tool_use") {
        emit({ type: "done", stopReason: turn.stopReason ?? "end_turn", usage: totalUsage });
        return;
      }

      // Echo the assistant turn (including tool_use blocks) back into history.
      messages.push({ role: "assistant", content: turn.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of turn.content) {
        if (block.type !== "tool_use") continue;
        const input = block.input as Record<string, unknown>;
        emit({
          type: "tool_start",
          id: block.id,
          name: block.name,
          label: describeToolCall(block.name, input),
          input,
        });
        const outcome = await executeTool(block.name, input, runId);
        emit({
          type: "tool_result",
          id: block.id,
          name: block.name,
          output: outcome.output.slice(0, 4000),
          isError: Boolean(outcome.isError),
          edit: outcome.edit,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: outcome.output,
          is_error: Boolean(outcome.isError),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
    emit({ type: "done", stopReason: "max_iterations", usage: totalUsage });
  } catch (err) {
    if (signal.aborted) {
      emit({ type: "done", stopReason: "cancelled", usage: totalUsage });
      return;
    }
    const anthropicErr = err as { status?: number; message?: string };
    let message = anthropicErr.message ?? String(err);
    if (anthropicErr.status === 401) message = "Invalid Anthropic API key. Update it in Settings.";
    if (anthropicErr.status === 429) message = "Rate limited by the Anthropic API — try again shortly.";
    emit({ type: "error", message });
  }
}
