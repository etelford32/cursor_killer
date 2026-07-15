import { useEffect } from "react";
import { AIPanel } from "./components/AIPanel";
import { CommandPalette } from "./components/CommandPalette";
import { FileExplorer } from "./components/FileExplorer";
import { SettingsModal } from "./components/SettingsModal";
import { StatusBar } from "./components/StatusBar";
import { Tabs } from "./components/Tabs";
import { TerminalPanel } from "./components/Terminal";
import { EditorPane } from "./editor/EditorPane";
import { useStore } from "./state/store";

export default function App() {
  const showTerminal = useStore((s) => s.showTerminal);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const showSettings = useStore((s) => s.showSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const showPalette = useStore((s) => s.showPalette);
  const setShowPalette = useStore((s) => s.setShowPalette);
  const loadConfig = useStore((s) => s.loadConfig);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowPalette(!useStore.getState().showPalette);
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleTerminal();
      } else if (e.key === "Escape") {
        if (useStore.getState().showPalette) setShowPalette(false);
        else if (useStore.getState().showSettings) setShowSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowPalette, setShowSettings, toggleTerminal]);

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-brand">刀 Katana</span>
        <span className="titlebar-sub">the transparent AI editor</span>
        <span className="spacer" />
        <button className="icon-btn" title="Command palette (Ctrl+P)" onClick={() => setShowPalette(true)}>
          ⌘
        </button>
        <button className="icon-btn" title="Toggle terminal (Ctrl+J)" onClick={toggleTerminal}>
          ❯_
        </button>
        <button
          className="icon-btn"
          title="Settings"
          data-testid="open-settings"
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
      </div>

      <div className="main">
        <aside className="sidebar">
          <FileExplorer />
        </aside>
        <section className="center">
          <Tabs />
          <div className="editor-area">
            <EditorPane />
          </div>
          {showTerminal && (
            <div className="terminal-pane">
              <div className="panel-header">
                <span>Terminal</span>
                <button className="icon-btn" onClick={toggleTerminal}>✕</button>
              </div>
              <TerminalPanel />
            </div>
          )}
        </section>
        <aside className="ai-side">
          <AIPanel />
        </aside>
      </div>

      <StatusBar />
      {showSettings && <SettingsModal />}
      {showPalette && <CommandPalette />}
    </div>
  );
}
