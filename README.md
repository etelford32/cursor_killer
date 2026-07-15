# 刀 Katana

**A fast, transparent AI code editor — built as a direct competitor to Cursor.**

Katana keeps the ideas that made Cursor work (agent mode, codebase-aware chat,
inline AI edits) and fixes the parts that don't:

| | Cursor | Katana |
|---|---|---|
| Agent transparency | opaque context assembly | every tool call streams live; every edit is a reviewable diff |
| Undo an agent run | limited | per-file **Revert** from automatic checkpoints |
| Pricing | subscription + request caps | **bring your own Anthropic key** — no markup, no caps |
| Codebase context | background embeddings index (goes stale) | agentic grep/glob/read on the live tree — never stale |
| Footprint | full VS Code fork | small web app + Node server, opens instantly |
| Hackability | closed | ~4k lines of TypeScript; tools & prompts are plain source files |

## Quick start

```bash
npm install
npm run dev            # server on :3100, UI on http://localhost:5180
```

Open http://localhost:5180. Without an API key Katana runs in **mock mode** —
the full UI (streaming, tool cards, diff review, revert) works with a scripted
demo agent. Add your Anthropic API key in **Settings** (gear icon) to switch to
the real thing. The key is stored server-side in `~/.katana/config.json` and
never sent to the browser. You can also `export ANTHROPIC_API_KEY=…` instead.

To edit a different project: `KATANA_DIR=/path/to/project npm run dev`.

## Features

- **Agent mode** — give it a task; it explores with `grep`/`glob`/`read`,
  edits files (`write_file`, `str_replace`), and runs shell commands. Every
  step streams into the panel as it happens. Every file edit becomes a diff
  card with **Accept / Revert**; reverting restores the exact pre-run content
  from an automatic checkpoint (`.katana/checkpoints/`).
- **Chat mode** — codebase Q&A with read-only tools. Answers cite real
  `path:line` locations from files it actually opened.
- **Inline edit (`Ctrl+K`)** — select code, describe the change, review the
  streamed replacement, accept or reject in place.
- **Editor** — CodeMirror 6: syntax highlighting (TS/JS/Python/Rust/HTML/CSS/
  JSON/Markdown), search, bracket matching, folding, multiple tabs, dirty
  indicators, `Ctrl+S` save.
- **Terminal (`Ctrl+J`)** — a real PTY (node-pty) in the workspace, with a
  pipe-mode fallback where native builds aren't available.
- **Command palette (`Ctrl+P`)** — fuzzy file open + commands.
- **Per-surface models** — pick the Claude model for agent / chat / inline
  edit independently in Settings (defaults to `claude-opus-4-8`).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl/Cmd+P` | Command palette / open file |
| `Ctrl/Cmd+K` | Inline AI edit on selection |
| `Ctrl/Cmd+S` | Save file |
| `Ctrl/Cmd+J` | Toggle terminal |
| `Enter` / `Shift+Enter` | Send AI prompt / newline |

## Architecture

```
server/   Node + Express + ws
  src/workspace.ts     sandboxed FS: tree, read/write, search, glob
  src/tools.ts         agent tool definitions + executors
  src/checkpoints.ts   pre-edit snapshots → per-file/run revert
  src/ai/engine.ts     Claude streaming tool loop → SSE events
  src/ai/mock.ts       keyless demo provider (same event protocol)
  src/ai/inline.ts     Ctrl+K single-shot edit streaming
  src/terminal.ts      PTY over WebSocket (node-pty, pipe fallback)
client/   Vite + React + CodeMirror 6 + zustand
  src/editor/          CM6 setup, theme, languages, inline-edit overlay
  src/components/      explorer, tabs, AI panel, diff cards, terminal,
                       settings, command palette
```

The agent loop is a plain Claude Messages API tool loop
(`@anthropic-ai/sdk`, streaming, adaptive thinking). Chat mode gets read-only
tools; agent mode adds `write_file`, `str_replace`, and `run_command`. All
file paths are resolved against the workspace root and traversal is rejected.

## Development

```bash
npm run typecheck      # both workspaces
npm run dev:server     # server only (tsx watch)
npm run dev:client     # client only (vite)
```

See [PLAN.md](PLAN.md) for the product plan and roadmap (tab autocomplete,
multi-provider backends, and desktop packaging are the next milestones).
