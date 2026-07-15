import { useEffect, useState } from "react";
import type { TreeNode } from "../api";
import { useStore } from "../state/store";

function NodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const openFile = useStore((s) => s.openFile);
  const active = useStore((s) => s.active);

  if (node.type === "file") {
    return (
      <div
        className={`tree-row ${active === node.path ? "active" : ""}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => void openFile(node.path)}
        title={node.path}
      >
        <span className="tree-icon file-icon">{iconFor(node.name)}</span>
        <span className="tree-name">{node.name}</span>
      </div>
    );
  }
  return (
    <div>
      <div
        className="tree-row dir"
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => setOpen(!open)}
      >
        <span className={`tree-caret ${open ? "open" : ""}`}>▸</span>
        <span className="tree-name">{node.name}</span>
      </div>
      {open &&
        node.children?.map((child) => <NodeRow key={child.path} node={child} depth={depth + 1} />)}
    </div>
  );
}

function iconFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "TS";
    case "js":
    case "jsx":
    case "mjs":
      return "JS";
    case "py":
      return "PY";
    case "md":
      return "M↓";
    case "json":
      return "{}";
    case "html":
      return "<>";
    case "css":
    case "scss":
      return "#";
    case "rs":
      return "RS";
    default:
      return "·";
  }
}

export function FileExplorer() {
  const tree = useStore((s) => s.tree);
  const refreshTree = useStore((s) => s.refreshTree);
  const config = useStore((s) => s.config);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  return (
    <div className="explorer" data-testid="explorer">
      <div className="panel-header">
        <span>{config?.workspace ?? "Explorer"}</span>
        <button className="icon-btn" title="Refresh" onClick={() => void refreshTree()}>
          ⟳
        </button>
      </div>
      <div className="explorer-tree">
        {tree?.children?.map((child) => <NodeRow key={child.path} node={child} depth={0} />)}
        {tree && !tree.children?.length && <div className="explorer-empty">Empty workspace</div>}
      </div>
    </div>
  );
}
