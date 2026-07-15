import { create } from "zustand";
import { api, streamSse, type AiEvent, type AppConfig, type FileEdit, type TreeNode } from "../api";

// ---------- AI conversation model ----------

export interface ToolPart {
  t: "tool";
  id: string;
  name: string;
  label: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  edit?: FileEdit;
  /** UI review state for edits */
  review?: "pending" | "accepted" | "reverted";
}

export interface TextPart {
  t: "text";
  text: string;
}

export type AssistantPart = TextPart | ToolPart;

export type ChatItem =
  | { kind: "user"; text: string }
  | {
      kind: "assistant";
      runId: string;
      mock: boolean;
      model: string;
      parts: AssistantPart[];
      status: "streaming" | "done" | "error";
      stopReason?: string;
      error?: string;
      usage?: { input: number; output: number };
    };

export type AiMode = "chat" | "agent";

interface OpenFile {
  content: string;
  savedContent: string;
}

interface OmniState {
  // filesystem
  tree: TreeNode | null;
  refreshTree: () => Promise<void>;

  // editor
  openFiles: Record<string, OpenFile>;
  tabs: string[];
  active: string | null;
  openFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
  setContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  reloadIfOpen: (path: string) => Promise<void>;

  // config
  config: AppConfig | null;
  loadConfig: () => Promise<void>;

  // AI
  aiMode: AiMode;
  setAiMode: (m: AiMode) => void;
  conversation: ChatItem[];
  aiBusy: boolean;
  sendPrompt: (text: string) => Promise<void>;
  stopAi: () => void;
  clearConversation: () => void;
  reviewEdit: (runId: string, toolId: string, action: "accept" | "revert") => Promise<void>;

  // panels
  showTerminal: boolean;
  toggleTerminal: () => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  showPalette: boolean;
  setShowPalette: (v: boolean) => void;

  aiAbort: AbortController | null;
}

export const useStore = create<OmniState>((set, get) => ({
  tree: null,
  refreshTree: async () => {
    set({ tree: await api.tree() });
  },

  openFiles: {},
  tabs: [],
  active: null,

  openFile: async (path) => {
    const { openFiles, tabs } = get();
    if (!openFiles[path]) {
      const { content } = await api.readFile(path);
      set({
        openFiles: { ...get().openFiles, [path]: { content, savedContent: content } },
        tabs: tabs.includes(path) ? tabs : [...tabs, path],
        active: path,
      });
    } else {
      set({ active: path, tabs: tabs.includes(path) ? tabs : [...tabs, path] });
    }
  },

  closeTab: (path) => {
    const { tabs, active, openFiles } = get();
    const nextTabs = tabs.filter((t) => t !== path);
    const nextFiles = { ...openFiles };
    delete nextFiles[path];
    set({
      tabs: nextTabs,
      openFiles: nextFiles,
      active: active === path ? nextTabs[nextTabs.length - 1] ?? null : active,
    });
  },

  setActive: (path) => set({ active: path }),

  setContent: (path, content) => {
    const file = get().openFiles[path];
    if (!file) return;
    set({ openFiles: { ...get().openFiles, [path]: { ...file, content } } });
  },

  saveFile: async (path) => {
    const file = get().openFiles[path];
    if (!file) return;
    await api.writeFile(path, file.content);
    set({
      openFiles: { ...get().openFiles, [path]: { ...file, savedContent: file.content } },
    });
    void get().refreshTree();
  },

  reloadIfOpen: async (path) => {
    const file = get().openFiles[path];
    if (!file) return;
    try {
      const { content } = await api.readFile(path);
      set({
        openFiles: { ...get().openFiles, [path]: { content, savedContent: content } },
      });
    } catch {
      // file was deleted (e.g. reverted creation) — close its tab
      get().closeTab(path);
    }
  },

  config: null,
  loadConfig: async () => set({ config: await api.config() }),

  aiMode: "agent",
  setAiMode: (m) => set({ aiMode: m }),
  conversation: [],
  aiBusy: false,
  aiAbort: null,

  sendPrompt: async (text) => {
    const { conversation, aiMode, aiBusy } = get();
    if (aiBusy || !text.trim()) return;

    // Condensed history: user text + assistant text parts from prior turns.
    const history = [
      ...conversation.map((item) =>
        item.kind === "user"
          ? { role: "user" as const, content: item.text }
          : {
              role: "assistant" as const,
              content:
                item.parts
                  .filter((p): p is TextPart => p.t === "text")
                  .map((p) => p.text)
                  .join("") || "(tool activity)",
            },
      ),
      { role: "user" as const, content: text },
    ];

    const abort = new AbortController();
    set({
      conversation: [...conversation, { kind: "user", text }],
      aiBusy: true,
      aiAbort: abort,
    });

    const updateAssistant = (fn: (a: Extract<ChatItem, { kind: "assistant" }>) => void) => {
      const conv = [...get().conversation];
      const last = conv[conv.length - 1];
      if (last?.kind === "assistant") {
        const copy = { ...last, parts: [...last.parts] };
        fn(copy);
        conv[conv.length - 1] = copy;
        set({ conversation: conv });
      }
    };

    const touchedPaths = new Set<string>();

    try {
      await streamSse<AiEvent>(
        aiMode === "agent" ? "/api/agent" : "/api/chat",
        { messages: history },
        (ev) => {
          switch (ev.type) {
            case "run_start":
              set({
                conversation: [
                  ...get().conversation,
                  {
                    kind: "assistant",
                    runId: ev.runId,
                    mock: ev.mock,
                    model: ev.model,
                    parts: [],
                    status: "streaming",
                  },
                ],
              });
              break;
            case "text":
              updateAssistant((a) => {
                const last = a.parts[a.parts.length - 1];
                if (last?.t === "text") {
                  a.parts[a.parts.length - 1] = { t: "text", text: last.text + ev.text };
                } else {
                  a.parts.push({ t: "text", text: ev.text });
                }
              });
              break;
            case "tool_start":
              updateAssistant((a) => {
                a.parts.push({
                  t: "tool",
                  id: ev.id,
                  name: ev.name,
                  label: ev.label,
                  input: ev.input,
                });
              });
              break;
            case "tool_result":
              updateAssistant((a) => {
                const idx = a.parts.findIndex((p) => p.t === "tool" && p.id === ev.id);
                if (idx !== -1) {
                  const tool = a.parts[idx] as ToolPart;
                  a.parts[idx] = {
                    ...tool,
                    output: ev.output,
                    isError: ev.isError,
                    edit: ev.edit,
                    review: ev.edit ? "pending" : undefined,
                  };
                }
              });
              if (ev.edit) touchedPaths.add(ev.edit.path);
              break;
            case "done":
              updateAssistant((a) => {
                a.status = "done";
                a.stopReason = ev.stopReason;
                a.usage = ev.usage;
              });
              break;
            case "error":
              updateAssistant((a) => {
                a.status = "error";
                a.error = ev.message;
              });
              break;
          }
        },
        abort.signal,
      );
    } catch (err) {
      if (!abort.signal.aborted) {
        const conv = [...get().conversation];
        const last = conv[conv.length - 1];
        if (last?.kind === "assistant" && last.status === "streaming") {
          conv[conv.length - 1] = { ...last, status: "error", error: (err as Error).message };
        } else {
          conv.push({
            kind: "assistant",
            runId: "local",
            mock: false,
            model: "",
            parts: [],
            status: "error",
            error: (err as Error).message,
          });
        }
        set({ conversation: conv });
      }
    } finally {
      set({ aiBusy: false, aiAbort: null });
      void get().refreshTree();
      for (const p of touchedPaths) void get().reloadIfOpen(p);
    }
  },

  stopAi: () => {
    get().aiAbort?.abort();
  },

  clearConversation: () => set({ conversation: [] }),

  reviewEdit: async (runId, toolId, action) => {
    if (action === "revert") {
      // Find the edit to know which path to revert.
      const conv = get().conversation;
      let editPath: string | undefined;
      for (const item of conv) {
        if (item.kind === "assistant" && item.runId === runId) {
          const tool = item.parts.find((p) => p.t === "tool" && p.id === toolId) as ToolPart | undefined;
          editPath = tool?.edit?.path;
        }
      }
      if (editPath) {
        await api.revert(runId, editPath);
        await get().reloadIfOpen(editPath);
        void get().refreshTree();
      }
    }
    set({
      conversation: get().conversation.map((item) => {
        if (item.kind !== "assistant" || item.runId !== runId) return item;
        return {
          ...item,
          parts: item.parts.map((p) =>
            p.t === "tool" && p.id === toolId
              ? { ...p, review: action === "accept" ? "accepted" : "reverted" }
              : p,
          ),
        };
      }),
    });
  },

  showTerminal: false,
  toggleTerminal: () => set({ showTerminal: !get().showTerminal }),
  showSettings: false,
  setShowSettings: (v) => set({ showSettings: v }),
  showPalette: false,
  setShowPalette: (v) => set({ showPalette: v }),
}));
