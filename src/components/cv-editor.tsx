"use client";

import {
  CSSProperties,
  ReactNode,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Editor, Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import History from "@tiptap/extension-history";

/**
 * The CV inline editor, backed by TipTap/ProseMirror (PRD v2 §0 editor
 * decision) instead of hand-rolled contentEditable.
 *
 * Design: click-to-edit. Every editable text node renders as its normal
 * styled tag; clicking (or tabbing into) it mounts ONE live TipTap instance
 * in place. At most one ProseMirror editor exists at any moment across the
 * whole CV — that keeps the swap lightweight while giving real editor
 * behavior: proper caret handling, per-field undo (⌘Z), smart Enter for
 * bullets (§3.3), and a background-aware high-contrast input surface (§2.1).
 */

/* ------------------------------------------------------------------ */
/* Active-editor registry — lets the RewriteTooltip apply AI rewrites   */
/* through ProseMirror commands instead of raw DOM surgery.             */
/* ------------------------------------------------------------------ */

let activeEditor: Editor | null = null;
export function getActiveCvEditor(): Editor | null {
  return activeEditor;
}

/* Smart-bullet focus handoff: after an Enter-split commits new bullets
   into the model, the freshly rendered bullet claims focus by key. */
let pendingFocusKey: string | null = null;
export function requestEditorFocus(key: string) {
  pendingFocusKey = key;
}

/* ------------------------------------------------------------------ */
/* §2.1 — computed-luminance background detection                       */
/* ------------------------------------------------------------------ */

/** Walks up from `el` to the first opaque background and reports darkness. */
function isDarkBackground(el: HTMLElement | null): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    const m = bg.match(
      /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/
    );
    if (m) {
      const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (alpha > 0.1) {
        const lum =
          (0.2126 * parseFloat(m[1]) +
            0.7152 * parseFloat(m[2]) +
            0.0722 * parseFloat(m[3])) /
          255;
        return lum < 0.5;
      }
    }
    node = node.parentElement;
  }
  return false;
}

/** High-contrast edit surface per §2.1: charcoal+white on dark, unchanged
 *  (indigo tint, dark caret) on light. Caret color is always explicit. */
function editSurfaceStyle(dark: boolean): CSSProperties {
  return dark
    ? {
        backgroundColor: "#121212",
        color: "#ffffff",
        caretColor: "#ffffff",
        boxShadow: "0 0 0 1.5px rgba(255,255,255,0.4)",
        borderRadius: 3,
      }
    : {
        backgroundColor: "#eef2ff",
        // Explicit dark text: the surface is light even when the template's
        // inherited text color is light-on-dark.
        color: "#0f172a",
        caretColor: "#0f172a",
        boxShadow: "0 0 0 1.5px rgba(99,102,241,0.35)",
        borderRadius: 3,
      };
}

/* ------------------------------------------------------------------ */
/* Editable — same call-site API as the old contentEditable version     */
/* ------------------------------------------------------------------ */

export type EditableProps = {
  value: string;
  /** Optional rich rendering of `value` (e.g. metric emphasis). Read-only:
   *  editing always falls back to the plain string so the caret stays sane. */
  children?: ReactNode;
  onCommit?: (v: string) => void;
  editable: boolean;
  className?: string;
  style?: CSSProperties;
  as?: "span" | "p" | "h1" | "h2" | "h3" | "li" | "div";
  /** Identity for smart-bullet focus handoff (bullet sites only). */
  focusKey?: string;
  /** §3.3 — Enter mid-text splits into a new sibling bullet. */
  onSplit?: (before: string, after: string) => void;
  /** §3.3 — Enter on an empty bullet deletes it and exits the list. */
  onExitEmpty?: () => void;
};

export function Editable({
  value,
  children,
  onCommit,
  editable,
  className,
  style,
  as: Tag = "span",
  focusKey,
  onSplit,
  onExitEmpty,
}: EditableProps) {
  const [active, setActive] = useState(false);
  const clickCoords = useRef<{ x: number; y: number } | null>(null);

  // A bullet freshly created by an Enter-split claims focus on mount.
  const claimPending =
    editable && focusKey !== undefined && pendingFocusKey === focusKey;
  useEffect(() => {
    if (claimPending) {
      pendingFocusKey = null;
      clickCoords.current = null;
      setActive(true);
    }
  }, [claimPending]);

  if (!editable) {
    return (
      <Tag className={className} style={style}>
        {children ?? value}
      </Tag>
    );
  }

  if (!active) {
    return (
      <Tag
        className={`${className ?? ""} cursor-text rounded-sm transition-colors duration-150 hover:bg-indigo-50/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300`}
        style={style}
        tabIndex={0}
        onMouseDown={(e) => {
          clickCoords.current = { x: e.clientX, y: e.clientY };
          e.preventDefault();
          setActive(true);
        }}
        onFocus={() => setActive(true)}
      >
        {children ?? value}
      </Tag>
    );
  }

  return (
    <ActiveEditor
      value={value}
      className={className}
      style={style}
      as={Tag}
      coordsRef={clickCoords}
      caretAtStart={claimPending}
      onDone={(next) => {
        setActive(false);
        if (onCommit && next !== value) onCommit(next);
      }}
      onSplit={
        onSplit &&
        ((before, after) => {
          setActive(false);
          onSplit(before, after);
        })
      }
      onExitEmpty={
        onExitEmpty &&
        (() => {
          setActive(false);
          onExitEmpty();
        })
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* The single live TipTap instance                                      */
/* ------------------------------------------------------------------ */

function ActiveEditor({
  value,
  className,
  style,
  as: Tag,
  coordsRef,
  caretAtStart,
  onDone,
  onSplit,
  onExitEmpty,
}: {
  value: string;
  className?: string;
  style?: CSSProperties;
  as: NonNullable<EditableProps["as"]>;
  coordsRef: RefObject<{ x: number; y: number } | null>;
  caretAtStart: boolean;
  onDone: (next: string) => void;
  onSplit?: (before: string, after: string) => void;
  onExitEmpty?: () => void;
}) {
  const [dark, setDark] = useState(false);
  // Guards double-commit: a split/exit already committed via its own path,
  // so the blur that follows must not commit the stale full text again.
  const settled = useRef(false);

  const editor = useEditor({
    immediatelyRender: true,
    extensions: [
      Document.extend({ content: "paragraph" }),
      Paragraph,
      Text,
      History,
      Extension.create({
        name: "cvKeys",
        addKeyboardShortcuts() {
          return {
            Enter: () => {
              const { state } = this.editor;
              const text = state.doc.textContent;
              // Also consult the visible DOM: if it disagrees with the PM
              // state (mid-sync), what the user SEES wins for the empty check.
              const domText = this.editor.view.dom.textContent ?? "";
              if (
                onExitEmpty &&
                (text.trim() === "" || domText.trim() === "")
              ) {
                settled.current = true;
                onExitEmpty();
                return true;
              }
              if (onSplit) {
                const { from, to } = state.selection;
                const end = state.doc.content.size - 1;
                const before = state.doc.textBetween(1, from);
                const after = state.doc.textBetween(to, end);
                settled.current = true;
                onSplit(before, after);
                return true;
              }
              this.editor.commands.blur();
              return true;
            },
            Escape: () => {
              this.editor.commands.blur();
              return true;
            },
          };
        },
      }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: value ? [{ type: "text", text: value }] : [],
        },
      ],
    },
    onBlur: ({ editor }) => {
      if (settled.current) return;
      settled.current = true;
      onDone(editor.getText().trim());
    },
  });

  // Register as THE active editor (for the RewriteTooltip), detect the
  // underlying background luminance, and place the caret where clicked.
  useEffect(() => {
    if (!editor) return;
    activeEditor = editor;
    // Measure from ABOVE the editor host: the host itself carries the edit
    // surface style, which would poison the luminance reading. view.dom is
    // the .ProseMirror node; its parent is the EditorContent host div.
    setDark(
      isDarkBackground(editor.view.dom.parentElement?.parentElement ?? null)
    );
    const raf = requestAnimationFrame(() => {
      const coords = coordsRef.current;
      if (coords) {
        const pos = editor.view.posAtCoords({ left: coords.x, top: coords.y });
        editor.commands.focus(pos ? pos.pos : "end");
      } else {
        editor.commands.focus(caretAtStart ? "start" : "end");
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      if (activeEditor === editor) activeEditor = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // The EditorContent <div> REPLACES the semantic tag while editing — a div
  // nested inside p/h1/span is invalid HTML that browsers hoist out (breaking
  // the surface styling), so we style the div like the tag instead. `display`
  // keeps the text flowing as before; list-item keeps the bullet marker.
  const display =
    Tag === "span" ? "inline" : Tag === "li" ? "list-item" : "block";

  return (
    <EditorContent
      editor={editor}
      className={`${className ?? ""} cv-rte cv-rte-host`}
      style={{ ...style, display, ...editSurfaceStyle(dark) }}
    />
  );
}
