"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useRewriteHistory } from "@/lib/cv-session";
import { RewriteLength } from "@/lib/types";
import { getActiveCvEditor } from "@/components/cv-editor";

/**
 * Selection-anchored rewrite tool shared by both surfaces. When the user
 * highlights text inside an editable CV, a floating tooltip offers an AI
 * Refresh (with Short / Long structural variants) plus Undo/Redo to browse
 * previously-generated candidates WITHOUT spending quota.
 *
 * It relies on the CvRenderer's existing blur-to-commit behaviour: buttons
 * preventDefault on mousedown so the contentEditable never loses focus (the
 * selection stays alive); the final text is committed when the user clicks
 * away naturally, or immediately via "Use".
 *
 * The parent owns the network call + quota accounting via `onRewrite`, and
 * passes the live `rewritesUsed`/`maxRewrites` so the tooltip can show the
 * remaining budget and block at the cap.
 */
export function RewriteTooltip({
  containerRef,
  enabled,
  rewritesUsed,
  maxRewrites,
  onRewrite,
}: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  rewritesUsed: number;
  maxRewrites: number;
  /** Generate a rewrite; the parent spends one quota unit and returns the text. */
  onRewrite: (text: string, length: RewriteLength) => Promise<string>;
}) {
  const history = useRewriteHistory();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rangeRef = useRef<Range | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const mutatingRef = useRef(false); // ignore selectionchange from our own edits
  const remaining = Math.max(0, maxRewrites - rewritesUsed);

  const close = useCallback(() => {
    setPos(null);
    setError("");
    rangeRef.current = null;
    elRef.current = null;
    history.clear();
  }, [history]);

  // Track text selections inside the editable CV.
  useEffect(() => {
    if (!enabled) {
      setPos(null);
      return;
    }
    function onSelectionChange() {
      if (mutatingRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const container = containerRef.current;
      if (!container || !container.contains(range.commonAncestorContainer)) return;
      // Must sit inside a contentEditable node (an editable CV field).
      let node: Node | null = range.commonAncestorContainer;
      let editableEl: HTMLElement | null = null;
      while (node && node !== container) {
        if (node instanceof HTMLElement && node.isContentEditable) {
          editableEl = node;
          break;
        }
        node = node.parentNode;
      }
      if (!editableEl) return;
      const text = sel.toString().trim();
      if (text.length < 2) return;

      const rect = range.getBoundingClientRect();
      rangeRef.current = range.cloneRange();
      elRef.current = editableEl;
      history.start(text);
      setError("");
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [enabled, containerRef, history]);

  // Dismiss on Escape.
  useEffect(() => {
    if (!pos) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pos, close]);

  /** Replace the tracked selection with `text`, keeping it selected for
   *  re-edits. Inside the live TipTap field this MUST go through ProseMirror
   *  commands — raw DOM surgery would desync the editor state. */
  const replaceRange = useCallback((text: string) => {
    mutatingRef.current = true;
    const editor = getActiveCvEditor();
    if (editor) {
      const { from, to } = editor.state.selection;
      const chain = editor.chain().focus();
      if (text) {
        chain
          .insertContentAt({ from, to }, { type: "text", text })
          .setTextSelection({ from, to: from + text.length })
          .run();
      } else {
        chain.deleteRange({ from, to }).run();
      }
      setTimeout(() => (mutatingRef.current = false), 0);
      return;
    }
    // Fallback for plain contentEditable hosts.
    const range = rangeRef.current;
    const sel = window.getSelection();
    if (!range || !sel) {
      mutatingRef.current = false;
      return;
    }
    sel.removeAllRanges();
    sel.addRange(range);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    const nr = document.createRange();
    nr.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(nr);
    rangeRef.current = nr.cloneRange();
    // Release the guard after the event loop settles.
    setTimeout(() => (mutatingRef.current = false), 0);
  }, []);

  // §2.3 — click-outside dismissal: a click anywhere outside the tooltip
  // closes it WITHOUT applying changes. If an unapplied AI candidate is
  // showing, the original text is restored first (capture phase runs before
  // the field's blur-commit, so the discard always wins). Clicks inside the
  // tooltip never dismiss it.
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    if (!pos) return;
    function onDocMouseDown(e: MouseEvent) {
      const tip = tooltipRef.current;
      if (tip && e.target instanceof Node && tip.contains(e.target)) return;
      const h = historyRef.current;
      if (h.count > 1 && h.index > 0) replaceRange(h.original);
      close();
    }
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () =>
      document.removeEventListener("mousedown", onDocMouseDown, true);
  }, [pos, close, replaceRange]);

  async function generate(length: RewriteLength) {
    if (busy || remaining <= 0) return;
    setBusy(true);
    setError("");
    try {
      const text = await onRewrite(history.original, length);
      history.push(text);
      replaceRange(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rewrite failed");
    } finally {
      setBusy(false);
    }
  }

  function browse(dir: "undo" | "redo") {
    const target = dir === "undo" ? history.index - 1 : history.index + 1;
    if (target < 0 || target >= history.items.length) return;
    if (dir === "undo") history.undo();
    else history.redo();
    replaceRange(history.items[target]);
  }

  function apply() {
    elRef.current?.blur(); // commit via CvRenderer's onBlur handler
    close();
  }

  if (!enabled || !pos) return null;
  const atCap = remaining <= 0;

  return (
    <div
      ref={tooltipRef}
      className="fixed z-[60] -translate-x-1/2 -translate-y-full animate-[cv-pop_0.15s_ease-out]"
      style={{ left: pos.x, top: pos.y - 8 }}
      onMouseDown={(e) => e.preventDefault()} // keep the CV selection alive
    >
      <div className="flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-1 shadow-[0_8px_24px_rgba(30,43,36,0.18)]">
        <button
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-accent hover:bg-chip disabled:opacity-40"
          disabled={busy || atCap}
          onMouseDown={(e) => {
            e.preventDefault();
            generate("default");
          }}
          title={atCap ? "Rewrite quota reached" : "AI rewrite"}
        >
          {busy ? "…" : "↻"} Rewrite
        </button>
        <span className="h-4 w-px bg-border" />
        <button
          className="rounded-full px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-chip disabled:opacity-40"
          disabled={busy || atCap}
          onMouseDown={(e) => {
            e.preventDefault();
            generate("short");
          }}
          title="Rewrite shorter"
        >
          Short
        </button>
        <button
          className="rounded-full px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-chip disabled:opacity-40"
          disabled={busy || atCap}
          onMouseDown={(e) => {
            e.preventDefault();
            generate("long");
          }}
          title="Rewrite longer"
        >
          Long
        </button>
        <span className="h-4 w-px bg-border" />
        <button
          className="rounded-full px-1.5 py-1 text-xs text-ink-soft hover:bg-chip disabled:opacity-30"
          disabled={!history.canUndo}
          onMouseDown={(e) => {
            e.preventDefault();
            browse("undo");
          }}
          title="Previous version (free)"
        >
          ↶
        </button>
        <button
          className="rounded-full px-1.5 py-1 text-xs text-ink-soft hover:bg-chip disabled:opacity-30"
          disabled={!history.canRedo}
          onMouseDown={(e) => {
            e.preventDefault();
            browse("redo");
          }}
          title="Next version (free)"
        >
          ↷
        </button>
        {history.count > 1 && (
          <button
            className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-on-accent hover:bg-accent-hover"
            onMouseDown={(e) => {
              e.preventDefault();
              apply();
            }}
            title="Keep this version"
          >
            Use
          </button>
        )}
      </div>
      <div className="mt-1 text-center text-[10px] font-semibold text-ink-faint">
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : atCap ? (
          <span className="text-red-600">Rewrite limit reached</span>
        ) : (
          `${remaining} rewrite${remaining === 1 ? "" : "s"} left`
        )}
      </div>
    </div>
  );
}
