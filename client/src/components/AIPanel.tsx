import { useEffect, useRef, useState } from "react";
import { collapseContext, diffLines, diffStats } from "../diff";
import { useStore, type AssistantPart, type ChatItem, type ToolPart } from "../state/store";

function DiffCard({ tool, runId }: { tool: ToolPart; runId: string }) {
  const reviewEdit = useStore((s) => s.reviewEdit);
  const openFile = useStore((s) => s.openFile);
  const edit = tool.edit!;
  const lines = diffLines(edit.before ?? "", edit.after);
  const { added, removed } = diffStats(lines);
  const display = collapseContext(lines);

  return (
    <div className={`diff-card review-${tool.review}`} data-testid="diff-card">
      <div className="diff-card-header">
        <button className="diff-path" onClick={() => void openFile(edit.path)} title="Open file">
          {edit.path}
        </button>
        <span className="diff-stats">
          <span className="stat-add">+{added}</span> <span className="stat-del">−{removed}</span>
          {edit.before === null && <span className="stat-new">new file</span>}
        </span>
        <span className="diff-actions">
          {tool.review === "pending" && (
            <>
              <button className="btn btn-xs btn-primary" onClick={() => void reviewEdit(runId, tool.id, "accept")}>
                Accept
              </button>
              <button className="btn btn-xs" onClick={() => void reviewEdit(runId, tool.id, "revert")}>
                Revert
              </button>
            </>
          )}
          {tool.review === "accepted" && <span className="review-badge accepted">accepted</span>}
          {tool.review === "reverted" && <span className="review-badge reverted">reverted</span>}
        </span>
      </div>
      <pre className="diff-body">
        {display.map((l, i) =>
          l.kind === "skip" ? (
            <div key={i} className="diff-line skip">
              ⋯ {l.count} unchanged lines
            </div>
          ) : (
            <div key={i} className={`diff-line ${l.kind}`}>
              <span className="diff-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
              {l.text || " "}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}

function ToolCard({ tool, runId }: { tool: ToolPart; runId: string }) {
  const [open, setOpen] = useState(false);
  const running = tool.output === undefined;
  return (
    <div className="tool-card" data-testid="tool-card">
      <div className={`tool-row ${tool.isError ? "error" : ""}`} onClick={() => setOpen(!open)}>
        <span className={`tool-status ${running ? "running" : tool.isError ? "failed" : "ok"}`}>
          {running ? "◌" : tool.isError ? "✕" : "✓"}
        </span>
        <span className="tool-label">{tool.label}</span>
        <span className="tool-toggle">{open ? "▾" : "▸"}</span>
      </div>
      {open && tool.output !== undefined && <pre className="tool-output">{tool.output}</pre>}
      {tool.edit && <DiffCard tool={tool} runId={runId} />}
    </div>
  );
}

function AssistantMessage({ item }: { item: Extract<ChatItem, { kind: "assistant" }> }) {
  return (
    <div className="msg assistant" data-testid="assistant-msg">
      <div className="msg-meta">
        <span className="msg-author">Katana</span>
        <span className="msg-model">{item.mock ? "mock" : item.model}</span>
        {item.status === "streaming" && <span className="msg-streaming">working…</span>}
        {item.usage && item.status === "done" && (
          <span className="msg-usage">
            {item.usage.input.toLocaleString()} in / {item.usage.output.toLocaleString()} out
          </span>
        )}
      </div>
      {item.parts.map((part: AssistantPart, i: number) =>
        part.t === "text" ? (
          <div key={i} className="msg-text">
            {part.text}
          </div>
        ) : (
          <ToolCard key={part.id} tool={part} runId={item.runId} />
        ),
      )}
      {item.status === "error" && <div className="msg-error">⚠ {item.error}</div>}
    </div>
  );
}

export function AIPanel() {
  const conversation = useStore((s) => s.conversation);
  const aiMode = useStore((s) => s.aiMode);
  const setAiMode = useStore((s) => s.setAiMode);
  const aiBusy = useStore((s) => s.aiBusy);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const stopAi = useStore((s) => s.stopAi);
  const clearConversation = useStore((s) => s.clearConversation);
  const config = useStore((s) => s.config);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation]);

  const submit = () => {
    const text = draft.trim();
    if (!text || aiBusy) return;
    setDraft("");
    void sendPrompt(text);
  };

  return (
    <div className="ai-panel" data-testid="ai-panel">
      <div className="panel-header">
        <div className="mode-toggle" data-testid="mode-toggle">
          <button
            className={aiMode === "agent" ? "active" : ""}
            onClick={() => setAiMode("agent")}
            title="Agent can edit files and run commands"
          >
            Agent
          </button>
          <button
            className={aiMode === "chat" ? "active" : ""}
            onClick={() => setAiMode("chat")}
            title="Chat can read the codebase but not modify it"
          >
            Chat
          </button>
        </div>
        <span className="spacer" />
        {config?.mock && <span className="mock-badge" title="No API key — add one in Settings">mock</span>}
        <button className="icon-btn" title="New conversation" onClick={clearConversation}>
          ⊕
        </button>
      </div>

      <div className="ai-scroll" ref={scrollRef}>
        {conversation.length === 0 && (
          <div className="ai-empty">
            <p><strong>{aiMode === "agent" ? "Agent mode" : "Chat mode"}</strong></p>
            {aiMode === "agent" ? (
              <p>
                Give Katana a task. It explores your codebase, edits files, and runs
                commands — every step streams here, and every edit is a diff you can
                accept or revert.
              </p>
            ) : (
              <p>
                Ask about your codebase. Katana reads real files with grep/glob/read —
                no stale index — and cites paths it actually opened.
              </p>
            )}
          </div>
        )}
        {conversation.map((item, i) =>
          item.kind === "user" ? (
            <div key={i} className="msg user" data-testid="user-msg">
              <div className="msg-meta"><span className="msg-author">You</span></div>
              <div className="msg-text">{item.text}</div>
            </div>
          ) : (
            <AssistantMessage key={i} item={item} />
          ),
        )}
      </div>

      <div className="ai-input">
        <textarea
          data-testid="ai-input"
          value={draft}
          placeholder={aiMode === "agent" ? "Describe a task for the agent…" : "Ask about the codebase…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
        />
        <div className="ai-input-actions">
          <span className="ai-hint">⏎ send · ⇧⏎ newline</span>
          {aiBusy ? (
            <button className="btn" onClick={stopAi} data-testid="ai-stop">
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={submit} disabled={!draft.trim()} data-testid="ai-send">
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
