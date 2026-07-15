import { useState } from "react";
import { api } from "../api";
import { useStore } from "../state/store";

export function SettingsModal() {
  const config = useStore((s) => s.config);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const loadConfig = useStore((s) => s.loadConfig);

  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(config?.models ?? { agent: "", chat: "", inline: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveConfig({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        models,
      });
      await loadConfig();
      setSaved(true);
      setTimeout(() => setShowSettings(false), 600);
    } finally {
      setSaving(false);
    }
  };

  const surfaces: { key: "agent" | "chat" | "inline"; label: string; hint: string }[] = [
    { key: "agent", label: "Agent model", hint: "multi-file edits, commands" },
    { key: "chat", label: "Chat model", hint: "codebase Q&A" },
    { key: "inline", label: "Inline edit model", hint: "Ctrl+K rewrites" },
  ];

  return (
    <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="settings">
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={() => setShowSettings(false)}>✕</button>
        </div>

        <label className="field-label">
          Anthropic API key
          <span className="field-hint">
            {config?.hasKey ? "A key is configured. Enter a new one to replace it." : "No key yet — the app runs in mock mode until you add one."}
          </span>
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-…"
          autoComplete="off"
        />
        <p className="field-hint">
          Stored server-side in <code>~/.katana/config.json</code> — never sent to the browser.
          Katana calls the Claude API directly with your key: no middleman, no markup, no request caps.
        </p>

        <div className="model-grid">
          {surfaces.map(({ key, label, hint }) => (
            <label key={key} className="field-label">
              {label}
              <span className="field-hint">{hint}</span>
              <select
                value={models[key]}
                onChange={(e) => setModels({ ...models, [key]: e.target.value })}
              >
                {config?.availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
          </button>
          <button className="btn" onClick={() => setShowSettings(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
