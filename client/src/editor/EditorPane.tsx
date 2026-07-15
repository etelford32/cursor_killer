import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState, type Extension, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  highlightSpecialChars,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { useStore } from "../state/store";
import { languageFor } from "./languages";
import { omniHighlight, omniTheme } from "./theme";
import { InlineEditOverlay, type InlineEditRequest } from "../components/InlineEdit";

export function EditorPane() {
  const active = useStore((s) => s.active);
  const openFiles = useStore((s) => s.openFiles);
  const setContent = useStore((s) => s.setContent);
  const saveFile = useStore((s) => s.saveFile);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const currentPath = useRef<string | null>(null);
  const [inlineReq, setInlineReq] = useState<InlineEditRequest | null>(null);
  const inlineReqRef = useRef<InlineEditRequest | null>(null);
  inlineReqRef.current = inlineReq;

  const openInlineEdit = useCallback((view: EditorView): boolean => {
    if (inlineReqRef.current) return true;
    const sel = view.state.selection.main;
    const path = currentPath.current;
    if (!path) return true;
    const from = sel.empty ? view.state.doc.lineAt(sel.from).from : sel.from;
    const to = sel.empty ? view.state.doc.lineAt(sel.from).to : sel.to;
    setInlineReq({
      path,
      from,
      to,
      selection: view.state.sliceDoc(from, to),
      content: view.state.doc.toString(),
    });
    return true;
  }, []);

  const buildExtensions = useCallback(
    (path: string): Extension[] => [
      lineNumbers(),
      foldGutter(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      drawSelection(),
      rectangularSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            const p = currentPath.current;
            if (p) void saveFile(p);
            return true;
          },
        },
        {
          key: "Mod-k",
          run: (view) => openInlineEdit(view),
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      omniTheme,
      omniHighlight,
      langCompartment.current.of(languageFor(path)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && currentPath.current) {
          setContent(currentPath.current, update.state.doc.toString());
        }
      }),
      EditorView.lineWrapping,
    ],
    [openInlineEdit, saveFile, setContent],
  );

  // (Re)create the editor when the active file changes.
  useEffect(() => {
    if (!hostRef.current) return;
    if (!active) {
      viewRef.current?.destroy();
      viewRef.current = null;
      currentPath.current = null;
      return;
    }
    const file = useStore.getState().openFiles[active];
    if (!file) return;

    viewRef.current?.destroy();
    currentPath.current = active;
    setInlineReq(null);
    const view = new EditorView({
      state: EditorState.create({
        doc: file.content,
        extensions: buildExtensions(active),
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // If the buffer content changed outside the editor (agent edit, revert), sync it in.
  const activeContent = active ? openFiles[active]?.content : undefined;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || activeContent === undefined) return;
    const current = view.state.doc.toString();
    if (current !== activeContent) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: activeContent },
      });
    }
  }, [activeContent]);

  const applyInlineResult = useCallback(
    (req: InlineEditRequest, replacement: string) => {
      const view = viewRef.current;
      if (!view) return;
      const docLen = view.state.doc.length;
      const from = Math.min(req.from, docLen);
      const to = Math.min(req.to, docLen);
      view.dispatch({ changes: { from, to, insert: replacement } });
      setInlineReq(null);
      view.focus();
    },
    [],
  );

  if (!active) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-logo">Ω</div>
        <h2>Omni Code</h2>
        <p>The transparent AI code editor.</p>
        <ul>
          <li><kbd>Ctrl</kbd>+<kbd>P</kbd> open a file</li>
          <li><kbd>Ctrl</kbd>+<kbd>K</kbd> inline AI edit on a selection</li>
          <li><kbd>Ctrl</kbd>+<kbd>J</kbd> toggle terminal</li>
          <li><kbd>Ctrl</kbd>+<kbd>S</kbd> save</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="editor-pane">
      <div ref={hostRef} className="editor-host" data-testid="editor" />
      {inlineReq && (
        <InlineEditOverlay
          request={inlineReq}
          onApply={applyInlineResult}
          onClose={() => {
            setInlineReq(null);
            viewRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
