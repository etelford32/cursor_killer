import { useStore } from "../state/store";

export function StatusBar() {
  const active = useStore((s) => s.active);
  const openFiles = useStore((s) => s.openFiles);
  const config = useStore((s) => s.config);
  const aiBusy = useStore((s) => s.aiBusy);
  const aiMode = useStore((s) => s.aiMode);

  const file = active ? openFiles[active] : null;
  const dirty = file && file.content !== file.savedContent;

  return (
    <div className="status-bar" data-testid="status-bar">
      <span className="status-item brand">Ω omni</span>
      {active && (
        <span className="status-item">
          {active}
          {dirty ? " ●" : ""}
        </span>
      )}
      <span className="spacer" />
      {aiBusy && <span className="status-item ai-active">{aiMode} running…</span>}
      <span className="status-item">
        {config?.mock ? "AI: mock (no key)" : `AI: ${config?.models.agent ?? "…"}`}
      </span>
    </div>
  );
}
