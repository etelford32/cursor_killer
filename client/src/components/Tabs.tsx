import { useStore } from "../state/store";

export function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const openFiles = useStore((s) => s.openFiles);
  const setActive = useStore((s) => s.setActive);
  const closeTab = useStore((s) => s.closeTab);

  if (tabs.length === 0) return <div className="tabs tabs-empty" />;

  return (
    <div className="tabs" data-testid="tabs">
      {tabs.map((path) => {
        const file = openFiles[path];
        const dirty = file && file.content !== file.savedContent;
        const name = path.split("/").pop();
        return (
          <div
            key={path}
            className={`tab ${active === path ? "active" : ""}`}
            onClick={() => setActive(path)}
            title={path}
          >
            <span className="tab-name">{name}</span>
            <span
              className={`tab-close ${dirty ? "dirty" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(path);
              }}
            >
              {dirty ? "●" : "✕"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
