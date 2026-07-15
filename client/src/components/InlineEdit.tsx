import { useEffect, useRef, useState } from "react";
import { streamSse, type InlineEvent } from "../api";

export interface InlineEditRequest {
  path: string;
  from: number;
  to: number;
  selection: string;
  content: string;
}

interface Props {
  request: InlineEditRequest;
  onApply: (req: InlineEditRequest, replacement: string) => void;
  onClose: () => void;
}

/** The Cmd+K overlay: instruction input → streamed replacement → accept/reject. */
export function InlineEditOverlay({ request, onApply, onClose }: Props) {
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<"input" | "streaming" | "review" | "error">("input");
  const [preview, setPreview] = useState("");
  const [finalText, setFinalText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => abortRef.current?.abort();
  }, []);

  const submit = async () => {
    if (!instruction.trim() || phase === "streaming") return;
    setPhase("streaming");
    setPreview("");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamSse<InlineEvent>(
        "/api/inline",
        {
          path: request.path,
          content: request.content,
          selection: request.selection,
          from: request.from,
          to: request.to,
          instruction,
        },
        (ev) => {
          if (ev.type === "text") setPreview((p) => p + ev.text);
          else if (ev.type === "done") {
            setFinalText(ev.text);
            setPhase("review");
          } else if (ev.type === "error") {
            setError(ev.message);
            setPhase("error");
          }
        },
        abort.signal,
      );
    } catch (err) {
      if (!abort.signal.aborted) {
        setError((err as Error).message);
        setPhase("error");
      }
    }
  };

  return (
    <div className="inline-edit" data-testid="inline-edit">
      <div className="inline-edit-header">
        <span className="inline-edit-title">AI edit · {request.path}</span>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">✕</button>
      </div>
      <div className="inline-edit-body">
        <input
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Describe the change to the selected code…"
          disabled={phase === "streaming"}
        />
        {(phase === "streaming" || phase === "review") && (
          <pre className="inline-edit-preview">{preview || "…"}</pre>
        )}
        {phase === "error" && <div className="inline-edit-error">{error}</div>}
        <div className="inline-edit-actions">
          {phase === "input" && (
            <button className="btn btn-primary" onClick={() => void submit()} disabled={!instruction.trim()}>
              Generate ⏎
            </button>
          )}
          {phase === "streaming" && (
            <button
              className="btn"
              onClick={() => {
                abortRef.current?.abort();
                setPhase("input");
              }}
            >
              Cancel
            </button>
          )}
          {phase === "review" && (
            <>
              <button
                className="btn btn-primary"
                onClick={() => finalText !== null && onApply(request, finalText)}
              >
                Accept
              </button>
              <button className="btn" onClick={() => setPhase("input")}>
                Retry
              </button>
              <button className="btn" onClick={onClose}>
                Reject
              </button>
            </>
          )}
          {phase === "error" && (
            <button className="btn" onClick={() => setPhase("input")}>
              Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
