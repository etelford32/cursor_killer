import Anthropic from "@anthropic-ai/sdk";
import { getApiKey, isMockMode, loadConfig } from "../config.js";
import { INLINE_SYSTEM } from "./prompts.js";

export interface InlineRequest {
  path: string;
  /** Full file content (client-side buffer, may be unsaved) */
  content: string;
  /** Selected text to rewrite */
  selection: string;
  /** 0-based character offsets of the selection within content */
  from: number;
  to: number;
  instruction: string;
}

export type InlineEmit = (ev: { type: "text"; text: string } | { type: "done"; text: string } | { type: "error"; message: string }) => void;

const CONTEXT_CHARS = 4000;

/** Strip a single wrapping markdown code fence, if the model added one anyway. */
export function stripFence(text: string): string {
  const m = text.match(/^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : text;
}

export async function runInlineEdit(req: InlineRequest, emit: InlineEmit, signal: AbortSignal): Promise<void> {
  if (isMockMode()) {
    const marker = req.selection.includes("\n") ? "\n" : " ";
    const result = `${req.selection}${marker}/* Omni mock edit — instruction: ${req.instruction.slice(0, 80)} (add an API key in Settings for real edits) */`;
    for (const chunk of result.match(/.{1,24}/gs) ?? []) {
      emit({ type: "text", text: chunk });
      await new Promise((r) => setTimeout(r, 10));
    }
    emit({ type: "done", text: result });
    return;
  }

  const before = req.content.slice(Math.max(0, req.from - CONTEXT_CHARS), req.from);
  const after = req.content.slice(req.to, req.to + CONTEXT_CHARS);

  const userMessage = [
    `File: ${req.path}`,
    "",
    "Context before the selection:",
    "<context_before>",
    before,
    "</context_before>",
    "",
    "The selected code to rewrite:",
    "<selection>",
    req.selection,
    "</selection>",
    "",
    "Context after the selection:",
    "<context_after>",
    after,
    "</context_after>",
    "",
    `Instruction: ${req.instruction}`,
    "",
    "Output only the replacement for <selection>.",
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey: getApiKey() });
    const stream = client.messages.stream(
      {
        model: loadConfig().models.inline,
        max_tokens: 16_000,
        system: INLINE_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
      },
      { signal },
    );
    let full = "";
    stream.on("text", (delta) => {
      full += delta;
      emit({ type: "text", text: delta });
    });
    await stream.finalMessage();
    emit({ type: "done", text: stripFence(full) });
  } catch (err) {
    if (signal.aborted) return;
    emit({ type: "error", message: (err as Error).message });
  }
}
