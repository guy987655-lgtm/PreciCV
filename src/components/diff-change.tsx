import { DiffReport } from "@/lib/types";

type DiffChange = DiffReport["changes"][number];

/**
 * Renders the removed/added lines of one change-report entry.
 *
 * A reordered entry (or any entry whose original and updated text are
 * identical) is shown ONCE as a neutral "moved" line — never as the exact
 * same string highlighted in both red (removed) and green (added), which
 * read like a broken diff and confused users.
 */
export function DiffChangeLines({ change }: { change: DiffChange }) {
  const orig = change.original.trim();
  const upd = change.updated.trim();
  const unchanged = change.type === "reordered" || (!!orig && orig === upd);

  if (unchanged) {
    return (
      <p className="diff-moved mt-1">
        {change.type === "reordered" ? "↕ Moved: " : ""}
        {upd || orig}
      </p>
    );
  }
  return (
    <>
      {change.original && <p className="diff-removed mt-1">{change.original}</p>}
      {change.updated && <p className="diff-added mt-1">{change.updated}</p>}
    </>
  );
}
