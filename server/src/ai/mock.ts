import type Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import type { Emit } from "./engine.js";

/**
 * Deterministic mock provider used when no API key is configured (or MOCK_AI=1).
 * It emits the same event protocol and drives the REAL tool executors, so the
 * whole UI — streaming, tool cards, diffs, checkpoints — works without a key.
 */

interface TurnResult {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage?: { input: number; output: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function streamText(text: string, emit: Emit): Promise<Anthropic.ContentBlock> {
  for (const word of text.split(/(?<= )/)) {
    emit({ type: "text", text: word });
    await sleep(8);
  }
  return { type: "text", text, citations: null } as Anthropic.ContentBlock;
}

function toolUse(name: string, input: Record<string, unknown>): Anthropic.ContentBlock {
  return {
    type: "tool_use",
    id: `mock_${crypto.randomUUID().slice(0, 8)}`,
    name,
    input,
  } as Anthropic.ContentBlock;
}

function firstUserText(messages: Anthropic.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && typeof messages[i].content === "string") {
      return messages[i].content as string;
    }
  }
  return "(no prompt)";
}

export async function mockTurn(
  mode: "chat" | "agent",
  messages: Anthropic.MessageParam[],
  emit: Emit,
): Promise<TurnResult> {
  const step = messages.filter((m) => m.role === "assistant").length;
  const prompt = firstUserText(messages);

  if (mode === "chat") {
    if (step === 0) {
      const text = await streamText(
        "Mock mode is on (no Anthropic API key configured yet). Let me still show you how chat works — I'll scan the workspace first.\n\n",
        emit,
      );
      return { content: [text, toolUse("list_dir", { path: "." })], stopReason: "tool_use" };
    }
    const text = await streamText(
      [
        `Here's what I can tell you about the workspace (your question was: “${prompt.slice(0, 120)}”).`,
        "",
        "The directory listing above shows the project layout — in a real session I would now read the relevant files and answer with citations like `src/index.ts:42`.",
        "",
        "**To unlock real answers:** open **Settings** (gear icon, top right) and paste your Anthropic API key. Chat mode can read files, grep, and glob; Agent mode can also edit files and run commands.",
      ].join("\n"),
      emit,
    );
    return { content: [text], stopReason: "end_turn" };
  }

  // Agent mode: demonstrate the full loop — explore, edit (with diff + checkpoint), summarize.
  if (step === 0) {
    const text = await streamText(
      "Mock mode is on (no API key configured), so I'll run a scripted demo of the agent loop: explore → edit → review. Scanning the workspace…\n\n",
      emit,
    );
    return { content: [text, toolUse("list_dir", { path: "." })], stopReason: "tool_use" };
  }
  if (step === 1) {
    const text = await streamText("Now I'll make a real, revertable file edit so you can try the diff review flow.\n\n", emit);
    const content = [
      "# Katana agent demo",
      "",
      "This file was created by Katana's **mock agent** to demonstrate the edit → review flow.",
      "",
      `Your request was: “${prompt.slice(0, 200)}”`,
      "",
      "- Every agent edit shows up as a diff card you can **Accept** or **Revert**.",
      "- Reverting restores the exact pre-run content from the checkpoint.",
      "- Add your Anthropic API key in Settings to let the real agent do real work.",
      "",
    ].join("\n");
    return {
      content: [text, toolUse("write_file", { path: "KATANA_DEMO.md", content })],
      stopReason: "tool_use",
    };
  }
  const text = await streamText(
    [
      "Done. I created `KATANA_DEMO.md` — the diff card above shows exactly what changed.",
      "",
      "- Click **Revert** on the card to restore the pre-run state from the checkpoint.",
      "- In a real session I would explore with grep/glob, edit multiple files, and run your tests to verify.",
      "",
      "Add your Anthropic API key in **Settings** to switch from this demo to the real agent.",
    ].join("\n"),
    emit,
  );
  return { content: [text], stopReason: "end_turn" };
}
