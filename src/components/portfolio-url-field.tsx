"use client";

import { FormEvent, useState } from "react";
import { normalizePortfolioUrl, portfolioLabel } from "@/lib/portfolio";
import { savePortfolioUrl, usePortfolioUrl } from "@/lib/use-portfolio-url";
import { Button, Input } from "@/components/ui";

/**
 * Edits the portfolio link that every CV prints as a QR code. Shared by the
 * CV toolbar's dialog and My Account, so both validate the same way.
 */
export function PortfolioUrlField({
  signedIn,
  onDone,
}: {
  signedIn: boolean;
  /** After a save or removal — the toolbar dialog closes on it. */
  onDone?: () => void;
}) {
  const current = usePortfolioUrl(signedIn);
  // null = untouched, so the field follows the stored link (which can arrive
  // late, from the account) until the user starts typing.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const value = draft ?? (current ? portfolioLabel(current) : "");

  const finish = (url: string) => {
    savePortfolioUrl(url, signedIn);
    setDraft(null);
    setError("");
    setSaved(true);
    onDone?.();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = normalizePortfolioUrl(value);
    if (!url) {
      setError("Enter a web address, like yourname.com");
      return;
    }
    finish(url);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="portfolio-url" className="text-sm font-semibold text-ink">
        Portfolio link
      </label>
      <Input
        id="portfolio-url"
        type="text"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder="yourname.com"
        value={value}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
          setSaved(false);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby="portfolio-url-help"
      />
      <p id="portfolio-url-help" className="text-[13px] text-ink-faint">
        {error ? (
          <span className="text-red-700">{error}</span>
        ) : (
          "Prints a QR code under a clickable “View my portfolio” heading at the top of every CV you download."
        )}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!value.trim()}>
          Save
        </Button>
        {current && (
          <Button type="button" size="sm" variant="ghost" onClick={() => finish("")}>
            Remove
          </Button>
        )}
        {saved && !onDone && (
          <span className="text-[13px] font-semibold text-accent">Saved ✓</span>
        )}
      </div>
    </form>
  );
}
