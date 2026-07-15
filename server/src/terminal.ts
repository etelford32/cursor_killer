import type { WebSocket } from "ws";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getWorkspaceRoot } from "./workspace.js";

/**
 * Terminal sessions over WebSocket. Uses node-pty when its native module is
 * available (full TTY: colors, prompts, resize); falls back to a piped bash
 * process otherwise.
 *
 * Wire protocol (JSON):
 *   client → server: {type:"input", data} | {type:"resize", cols, rows}
 *   server → client: {type:"output", data} | {type:"exit", code} | {type:"info", data}
 */

type PtyModule = typeof import("node-pty");

let ptyModule: PtyModule | null | undefined;

async function loadPty(): Promise<PtyModule | null> {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = await import("node-pty");
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

export async function attachTerminal(ws: WebSocket): Promise<void> {
  const pty = await loadPty();
  const cwd = getWorkspaceRoot();
  const shell = process.env.SHELL || "bash";

  const send = (msg: object) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  if (pty) {
    const term = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
    });
    term.onData((data) => send({ type: "output", data }));
    term.onExit(({ exitCode }) => send({ type: "exit", code: exitCode }));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "input") term.write(msg.data);
        else if (msg.type === "resize") term.resize(msg.cols, msg.rows);
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on("close", () => term.kill());
    return;
  }

  // Pipe fallback — no TTY semantics, but commands still run.
  send({ type: "info", data: "[omni] node-pty unavailable — running in pipe mode\r\n" });
  const child: ChildProcessWithoutNullStreams = spawn("bash", ["-i"], {
    cwd,
    env: { ...process.env, TERM: "dumb" },
  });
  child.stdout.on("data", (d) => send({ type: "output", data: d.toString().replace(/\n/g, "\r\n") }));
  child.stderr.on("data", (d) => send({ type: "output", data: d.toString().replace(/\n/g, "\r\n") }));
  child.on("exit", (code) => send({ type: "exit", code: code ?? 0 }));
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === "input") child.stdin.write(msg.data.replace(/\r/g, "\n"));
    } catch {
      /* ignore malformed frames */
    }
  });
  ws.on("close", () => child.kill());
}
