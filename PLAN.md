# Katana — an AI code editor built to beat Cursor

## Context

Cursor proved that an AI-native editor is the right product, but it carries real baggage:
it's a heavyweight VS Code fork, its agent behavior is opaque (hidden context assembly,
background indexing), it requires a subscription with request caps and token markup, and
its embeddings-based codebase index goes stale. Katana is a ground-up, web-first AI editor
that keeps the good ideas (agent mode, codebase chat, inline edits) and fixes the rest.

## Product positioning — improvements over Cursor

1. **Transparent agent.** Every tool call the agent makes (read, edit, grep, run command)
   is streamed live into the UI as it happens. Every file change is a reviewable diff with
   per-file accept/reject and one-click checkpoint revert. No hidden context assembly.
2. **Bring-your-own-key.** Talks directly to the Claude API with your key. No subscription,
   no request caps, no token markup, no vendor lock-in on billing.
3. **Agentic search instead of stale embeddings.** The agent explores the codebase with
   grep/glob/read tools (the approach Claude Code uses), so there is no background indexing
   step, no stale vector DB, and answers cite real files.
4. **Lightweight and instant.** A browser app served by a small Node backend — opens in
   under a second, no VS Code fork to maintain. Desktop wrapper (Tauri/Electron) can come
   later without rearchitecting.
5. **Right model for each task.** Fast model (Haiku) for inline edits, frontier model
   (Sonnet/Opus) for agent work — user-configurable per surface.
6. **Open and hackable.** Small TypeScript codebase; the agent's tools and prompts are
   plain source files users can read and extend.

## Architecture

```
cursor_killer/
├── package.json          # npm workspaces root
├── server/               # Node 22 + TypeScript + Express + ws
│   └── src/
│       ├── index.ts      # HTTP + WS server, serves built client
│       ├── workspace.ts  # sandboxed FS ops: tree, read, write, search
│       ├── ai/
│       │   ├── client.ts # Anthropic SDK wrapper + mock provider
│       │   ├── chat.ts   # SSE streaming chat w/ read-only tools
│       │   ├── agent.ts  # agent loop: edit tools + run_command + checkpoints
│       │   └── inline.ts # Cmd+K single-shot edit streaming
│       ├── tools.ts      # tool definitions + executors (read/write/edit/glob/grep/run)
│       ├── checkpoints.ts# snapshot changed files before agent writes; revert
│       └── terminal.ts   # PTY sessions over WebSocket (node-pty, pipe fallback)
└── client/               # Vite + React 18 + TypeScript + zustand
    └── src/
        ├── App.tsx       # layout: explorer | editor tabs | AI panel, bottom terminal
        ├── editor/       # CodeMirror 6: languages, theme, tabs, inline Cmd+K UI
        ├── panels/       # FileExplorer, AIPanel (chat/agent), Terminal, DiffReview
        ├── state/        # zustand stores: files, tabs, ai session, settings
        └── api.ts        # REST/SSE/WS client
```

### Key flows

- **Agent mode** — POST `/api/agent` (SSE). Server runs a Claude tool-use loop with tools:
  `read_file`, `list_dir`, `glob`, `grep`, `write_file`, `str_replace`, `run_command`.
  Before the first write in a run, changed files are snapshotted to a checkpoint.
  Every tool call/result and text delta streams to the client; file edits surface as
  diff cards with accept (keep) / reject (restore from checkpoint) and "revert all".
- **Chat mode** — same loop restricted to read-only tools; answers grounded in the code.
- **Inline edit (Cmd+K)** — selection + instruction → POST `/api/inline` streams the
  replacement; editor shows old/new inline with accept/reject.
- **Terminal** — xterm.js in the client, PTY on the server over WebSocket.
- **Mock AI mode** — `MOCK_AI=1` (or missing API key) serves canned streams so the entire
  UI is demoable/testable without a key.

### Model defaults (user-configurable in Settings)

| Surface     | Default model     | Notes                                    |
|-------------|-------------------|------------------------------------------|
| Agent       | claude-opus-4-8   | most capable for agentic work            |
| Chat        | claude-opus-4-8   | codebase reasoning                       |
| Inline edit | claude-opus-4-8   | switch to Sonnet/Haiku in Settings if you prefer lower latency |

### Security/sandboxing

- All FS ops resolved against the workspace root; path traversal rejected.
- `run_command` executes inside the workspace dir; commands and output shown in UI.
- API key stored server-side in `~/.katana/config.json` (never sent to the browser).

## Milestones

1. **M1 — Editor shell**: workspaces scaffold, server FS API, file explorer, CodeMirror
   tabs, open/save, search, dark theme, status bar.
2. **M2 — AI core**: Anthropic client + mock provider, SSE chat with read tools, AI panel.
3. **M3 — Agent mode**: write tools, run_command, checkpoints, diff review UI.
4. **M4 — Inline Cmd+K** + command palette + settings (key, models).
5. **M5 — Terminal panel** + polish + README.

Out of scope for MVP: tab autocomplete (needs dedicated low-latency infra), multi-provider
backends, desktop packaging, collaboration. All have a clear seam to add later.

## Verification

- `npm run dev` boots server (:3100) + client (Vite).
- Playwright (pre-installed Chromium) drives the real UI: open file, edit, save, run
  mock-mode chat/agent flow, screenshot each surface.
- Agent loop unit-tested against the mock provider (tool dispatch, checkpoint/revert).
