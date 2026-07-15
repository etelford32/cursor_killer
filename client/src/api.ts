// REST + SSE client for the Katana server.

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

export interface FileEdit {
  path: string;
  before: string | null;
  after: string;
}

export type AiEvent =
  | { type: "run_start"; runId: string; mode: "chat" | "agent"; model: string; mock: boolean }
  | { type: "text"; text: string }
  | { type: "thinking" }
  | { type: "tool_start"; id: string; name: string; label: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean; edit?: FileEdit }
  | { type: "done"; stopReason: string; usage?: { input: number; output: number } }
  | { type: "error"; message: string };

export type InlineEvent =
  | { type: "text"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export interface AppConfig {
  hasKey: boolean;
  mock: boolean;
  models: { agent: string; chat: string; inline: string };
  availableModels: string[];
  workspace: string;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {
      /* keep status text */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tree: () => fetch("/api/tree").then((r) => jsonOrThrow<TreeNode>(r)),

  readFile: (path: string) =>
    fetch(`/api/file?path=${encodeURIComponent(path)}`).then((r) =>
      jsonOrThrow<{ path: string; content: string }>(r),
    ),

  writeFile: (path: string, content: string) =>
    fetch("/api/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).then((r) => jsonOrThrow<{ ok: boolean }>(r)),

  deleteFile: (path: string) =>
    fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }).then((r) =>
      jsonOrThrow<{ ok: boolean }>(r),
    ),

  search: (query: string, regex = false) =>
    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, regex }),
    }).then((r) => jsonOrThrow<{ hits: SearchHit[] }>(r)),

  config: () => fetch("/api/config").then((r) => jsonOrThrow<AppConfig>(r)),

  saveConfig: (update: { apiKey?: string; models?: Partial<AppConfig["models"]> }) =>
    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }).then((r) => jsonOrThrow<{ ok: boolean; mock: boolean }>(r)),

  revert: (runId: string, path?: string) =>
    fetch("/api/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, path }),
    }).then((r) => jsonOrThrow<{ ok: boolean; reverted: string[] }>(r)),
};

/** POST a body and consume the SSE response, invoking onEvent per event. */
export async function streamSse<E>(
  url: string,
  body: unknown,
  onEvent: (ev: E) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`AI request failed: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          onEvent(JSON.parse(line.slice(6)) as E);
        }
      }
    }
  }
}
