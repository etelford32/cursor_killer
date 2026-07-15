import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../api";
import { useStore } from "../state/store";

interface Entry {
  id: string;
  label: string;
  detail?: string;
  run: () => void;
}

function flattenFiles(node: TreeNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === "file") out.push(node.path);
  node.children?.forEach((c) => flattenFiles(c, out));
  return out;
}

function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette() {
  const tree = useStore((s) => s.tree);
  const refreshTree = useStore((s) => s.refreshTree);
  const openFile = useStore((s) => s.openFile);
  const setShowPalette = useStore((s) => s.setShowPalette);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const clearConversation = useStore((s) => s.clearConversation);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    void refreshTree();
  }, [refreshTree]);

  const entries = useMemo<Entry[]>(() => {
    const close = () => setShowPalette(false);
    const commands: Entry[] = [
      { id: ">terminal", label: "> Toggle terminal", run: () => { toggleTerminal(); close(); } },
      { id: ">settings", label: "> Open settings", run: () => { setShowSettings(true); close(); } },
      { id: ">clear-ai", label: "> New AI conversation", run: () => { clearConversation(); close(); } },
    ];
    const files: Entry[] = flattenFiles(tree).map((path) => ({
      id: path,
      label: path.split("/").pop() ?? path,
      detail: path,
      run: () => { void openFile(path); close(); },
    }));
    const all = [...commands, ...files];
    if (!query.trim()) return all.slice(0, 30);
    return all.filter((e) => fuzzyMatch(query, e.detail ?? e.label) || fuzzyMatch(query, e.label)).slice(0, 30);
  }, [tree, query, openFile, setShowPalette, toggleTerminal, setShowSettings, clearConversation]);

  useEffect(() => setSelected(0), [query]);

  return (
    <div className="modal-backdrop palette-backdrop" onClick={() => setShowPalette(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()} data-testid="palette">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a file name, or > for commands…"
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowPalette(false);
            if (e.key === "ArrowDown") setSelected((s) => Math.min(s + 1, entries.length - 1));
            if (e.key === "ArrowUp") setSelected((s) => Math.max(s - 1, 0));
            if (e.key === "Enter") entries[selected]?.run();
          }}
        />
        <div className="palette-list">
          {entries.map((e, i) => (
            <div
              key={e.id}
              className={`palette-item ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => e.run()}
            >
              <span>{e.label}</span>
              {e.detail && <span className="palette-detail">{e.detail}</span>}
            </div>
          ))}
          {entries.length === 0 && <div className="palette-item">No matches</div>}
        </div>
      </div>
    </div>
  );
}
