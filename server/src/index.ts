import express, { type Request, type Response } from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  deletePath,
  getWorkspaceRoot,
  readFileContent,
  readTree,
  renamePath,
  searchWorkspace,
  setWorkspaceRoot,
  writeFileContent,
} from "./workspace.js";
import { revertFile, revertRun } from "./checkpoints.js";
import { runAi, type HistoryMessage } from "./ai/engine.js";
import { runInlineEdit, type InlineRequest } from "./ai/inline.js";
import { attachTerminal } from "./terminal.js";
import { AVAILABLE_MODELS, isMockMode, loadConfig, saveConfig } from "./config.js";

const PORT = Number(process.env.PORT) || 3100;

// Workspace root: --dir flag > KATANA_DIR env > cwd
const dirArg = process.argv.indexOf("--dir");
setWorkspaceRoot(
  dirArg !== -1 ? process.argv[dirArg + 1] : process.env.KATANA_DIR || process.cwd(),
);

const app = express();
app.use(express.json({ limit: "10mb" }));

// ---------- filesystem ----------

app.get("/api/tree", async (_req, res) => {
  try {
    res.json(await readTree("."));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/file", async (req, res) => {
  try {
    const rel = String(req.query.path ?? "");
    res.json({ path: rel, content: await readFileContent(rel) });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

app.put("/api/file", async (req, res) => {
  try {
    const { path: rel, content } = req.body as { path: string; content: string };
    await writeFileContent(rel, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/file", async (req, res) => {
  try {
    await deletePath(String(req.query.path ?? ""));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/rename", async (req, res) => {
  try {
    const { from, to } = req.body as { from: string; to: string };
    await renamePath(from, to);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/search", async (req, res) => {
  try {
    const { query, regex } = req.body as { query: string; regex?: boolean };
    res.json({ hits: await searchWorkspace(query, { regex }) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- config ----------

app.get("/api/config", (_req, res) => {
  const config = loadConfig();
  res.json({
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY || config.apiKey),
    mock: isMockMode(),
    models: config.models,
    availableModels: AVAILABLE_MODELS,
    workspace: path.basename(getWorkspaceRoot()),
  });
});

app.post("/api/config", (req, res) => {
  const { apiKey, models } = req.body as {
    apiKey?: string;
    models?: Partial<{ agent: string; chat: string; inline: string }>;
  };
  const update: Parameters<typeof saveConfig>[0] = {};
  if (typeof apiKey === "string" && apiKey.trim()) update.apiKey = apiKey.trim();
  if (models) update.models = { ...loadConfig().models, ...models };
  saveConfig(update);
  res.json({ ok: true, mock: isMockMode() });
});

// ---------- AI (SSE) ----------

function sseHeaders(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function sseSender(res: Response) {
  return (ev: object) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

async function handleAiRequest(mode: "chat" | "agent", req: Request, res: Response): Promise<void> {
  const { messages } = req.body as { messages: HistoryMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages required" });
    return;
  }
  sseHeaders(res);
  const controller = new AbortController();
  // res 'close' fires when the client disconnects mid-stream (or after our own
  // res.end(), by which point the run has already finished — abort is a no-op).
  res.on("close", () => controller.abort());
  await runAi(mode, messages, sseSender(res), controller.signal);
  res.end();
}

app.post("/api/chat", (req, res) => void handleAiRequest("chat", req, res));
app.post("/api/agent", (req, res) => void handleAiRequest("agent", req, res));

app.post("/api/inline", async (req, res) => {
  const body = req.body as InlineRequest;
  if (!body?.instruction || typeof body.selection !== "string") {
    res.status(400).json({ error: "selection and instruction required" });
    return;
  }
  sseHeaders(res);
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  await runInlineEdit(body, sseSender(res), controller.signal);
  res.end();
});

// ---------- checkpoints ----------

app.post("/api/revert", (req, res) => {
  try {
    const { runId, path: rel } = req.body as { runId: string; path?: string };
    if (rel) {
      revertFile(runId, rel);
      res.json({ ok: true, reverted: [rel] });
    } else {
      res.json({ ok: true, reverted: revertRun(runId) });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- static client (production) ----------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

// ---------- server + websockets ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/term" });
wss.on("connection", (ws) => void attachTerminal(ws));

server.listen(PORT, () => {
  console.log(`[katana] server on http://localhost:${PORT}`);
  console.log(`[katana] workspace: ${getWorkspaceRoot()}`);
  console.log(`[katana] ai: ${isMockMode() ? "MOCK MODE (no API key)" : "Claude API"}`);
});
