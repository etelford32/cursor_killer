import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { snapshotBeforeWrite } from "./checkpoints.js";
import {
  getWorkspaceRoot,
  globFiles,
  readFileContent,
  resolveSafe,
  searchWorkspace,
  toRel,
  writeFileContent,
} from "./workspace.js";

const MAX_TOOL_OUTPUT = 30_000;

function truncate(s: string, max = MAX_TOOL_OUTPUT): string {
  return s.length > max ? s.slice(0, max) + `\n… [truncated ${s.length - max} chars]` : s;
}

export interface FileEdit {
  path: string;
  before: string | null;
  after: string;
}

export interface ToolOutcome {
  /** Text fed back to the model as the tool_result. */
  output: string;
  isError?: boolean;
  /** Present when the tool modified a file — surfaced to the UI as a diff card. */
  edit?: FileEdit;
}

export const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Read a file from the workspace. Returns the content with line numbers. Use offset/limit for large files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        offset: { type: "integer", description: "1-based line to start from (optional)" },
        limit: { type: "integer", description: "Max number of lines to return (optional)" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List the entries of a workspace directory. Directories end with '/'.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative directory path, '.' for root" },
      },
      required: ["path"],
    },
  },
  {
    name: "glob",
    description:
      "Find files matching a glob pattern, e.g. '**/*.ts' or 'src/**/*.py'. Returns matching workspace-relative paths.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description:
      "Search file contents across the workspace. Returns 'path:line: text' matches. Use regex=true for regular expressions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex to search for" },
        regex: { type: "boolean", description: "Treat query as a regular expression" },
      },
      required: ["query"],
    },
  },
];

export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "write_file",
    description:
      "Create or overwrite a file with the given content. Parent directories are created automatically.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        content: { type: "string", description: "Full new file content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "str_replace",
    description:
      "Replace an exact string in a file with a new string. The old string must appear exactly once — include enough surrounding context to make it unique.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        old_str: { type: "string", description: "Exact text to replace (must be unique in the file)" },
        new_str: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command inside the workspace (bash). Returns stdout+stderr and the exit code. 60s timeout. Use for builds, tests, git, installs.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
      },
      required: ["command"],
    },
  },
];

export const AGENT_TOOLS: Anthropic.Tool[] = [...READ_TOOLS, ...WRITE_TOOLS];

function runShell(command: string): Promise<{ output: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      "bash",
      ["-c", command],
      {
        cwd: getWorkspaceRoot(),
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (err, stdout, stderr) => {
        const code = err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0;
        let output = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
        if (err && (err as any).killed) output += "\n[command timed out after 60s]";
        resolve({ output, code });
      },
    );
    void child;
  });
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  runId: string,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "read_file": {
        const rel = String(input.path);
        const content = await readFileContent(rel);
        const lines = content.split("\n");
        const offset = Math.max(1, Number(input.offset) || 1);
        const limit = Number(input.limit) || 2000;
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = slice.map((l, i) => `${offset + i}\t${l}`).join("\n");
        return { output: truncate(numbered) || "(empty file)" };
      }
      case "list_dir": {
        const rel = String(input.path ?? ".");
        const abs = resolveSafe(rel);
        const entries = await fsp.readdir(abs, { withFileTypes: true });
        const listing = entries
          .filter((e) => e.name !== "node_modules" && e.name !== ".git" && e.name !== ".omnicode")
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .join("\n");
        return { output: truncate(listing) || "(empty directory)" };
      }
      case "glob": {
        const files = await globFiles(String(input.pattern));
        return { output: truncate(files.join("\n")) || "(no matches)" };
      }
      case "grep": {
        const hits = await searchWorkspace(String(input.query), {
          regex: Boolean(input.regex),
          maxResults: 100,
        });
        const out = hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n");
        return { output: truncate(out) || "(no matches)" };
      }
      case "write_file": {
        const rel = toRel(resolveSafe(String(input.path)));
        const after = String(input.content);
        let before: string | null = null;
        try {
          before = await readFileContent(rel);
        } catch {
          before = null;
        }
        snapshotBeforeWrite(runId, rel);
        await writeFileContent(rel, after);
        return {
          output: `Wrote ${after.length} chars to ${rel}`,
          edit: { path: rel, before, after },
        };
      }
      case "str_replace": {
        const rel = toRel(resolveSafe(String(input.path)));
        const before = await readFileContent(rel);
        const oldStr = String(input.old_str);
        const newStr = String(input.new_str);
        const count = before.split(oldStr).length - 1;
        if (count === 0) {
          return { output: `old_str not found in ${rel}. Read the file again — content may have changed.`, isError: true };
        }
        if (count > 1) {
          return { output: `old_str appears ${count} times in ${rel}; it must be unique. Add more surrounding context.`, isError: true };
        }
        const after = before.replace(oldStr, newStr);
        snapshotBeforeWrite(runId, rel);
        await writeFileContent(rel, after);
        return {
          output: `Replaced 1 occurrence in ${rel}`,
          edit: { path: rel, before, after },
        };
      }
      case "run_command": {
        const { output, code } = await runShell(String(input.command));
        return {
          output: truncate(output ? `${output}\n(exit ${code})` : `(exit ${code})`),
          isError: code !== 0,
        };
      }
      default:
        return { output: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { output: `Error: ${(err as Error).message}`, isError: true };
  }
}

export function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "read_file":
      return `Read ${input.path}`;
    case "list_dir":
      return `List ${input.path}`;
    case "glob":
      return `Glob ${input.pattern}`;
    case "grep":
      return `Grep "${input.query}"`;
    case "write_file":
      return `Write ${input.path}`;
    case "str_replace":
      return `Edit ${input.path}`;
    case "run_command":
      return `Run: ${String(input.command).slice(0, 120)}`;
    default:
      return name;
  }
}

export { path };
