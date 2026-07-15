import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Omni dark — a restrained slate/steel palette with a single red accent.

export const omniTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#101418",
      color: "#d7dde3",
      fontSize: "13px",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "#ff5c57",
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
      padding: "8px 0",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ff5c57" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection": {
      backgroundColor: "#264f78 !important",
    },
    ".cm-selectionBackground": { backgroundColor: "#22364a" },
    ".cm-activeLine": { backgroundColor: "#161c22" },
    ".cm-activeLineGutter": { backgroundColor: "#161c22", color: "#8b98a5" },
    ".cm-gutters": {
      backgroundColor: "#101418",
      color: "#4a5560",
      border: "none",
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
      fontSize: "12px",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 16px" },
    ".cm-matchingBracket": {
      backgroundColor: "#2a3f55",
      outline: "1px solid #3f5c7a",
    },
    ".cm-searchMatch": { backgroundColor: "#5a4a1f" },
    ".cm-searchMatch-selected": { backgroundColor: "#7a6220" },
    ".cm-panels": { backgroundColor: "#171d24", color: "#d7dde3" },
    ".cm-panels input": {
      backgroundColor: "#101418",
      color: "#d7dde3",
      border: "1px solid #2a333d",
    },
    ".cm-tooltip": {
      backgroundColor: "#1b232c",
      border: "1px solid #2a333d",
      color: "#d7dde3",
    },
  },
  { dark: true },
);

export const omniHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "#c792ea" },
    { tag: [t.name, t.deleted, t.character, t.macroName], color: "#d7dde3" },
    { tag: [t.propertyName], color: "#82aaff" },
    { tag: [t.variableName, t.definition(t.variableName)], color: "#e2e8f0" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#82aaff" },
    { tag: [t.labelName], color: "#f78c6c" },
    { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#f78c6c" },
    { tag: [t.typeName, t.className, t.namespace], color: "#ffcb6b" },
    { tag: [t.number], color: "#f78c6c" },
    { tag: [t.string, t.special(t.string)], color: "#c3e88d" },
    { tag: [t.regexp, t.escape], color: "#89ddff" },
    { tag: [t.operator, t.operatorKeyword, t.punctuation, t.separator], color: "#89ddff" },
    { tag: [t.url, t.link], color: "#89ddff", textDecoration: "underline" },
    { tag: [t.meta, t.comment, t.lineComment, t.blockComment], color: "#5c6773", fontStyle: "italic" },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#ff5c57" },
    { tag: [t.heading], color: "#82aaff", fontWeight: "bold" },
    { tag: [t.emphasis], fontStyle: "italic" },
    { tag: [t.strong], fontWeight: "bold" },
    { tag: [t.invalid], color: "#ff5370" },
  ]),
);
