"use client";

import { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/* Shadcn-style primitives, hand-rolled on Tailwind v4 — "Sage & Ink" skin */

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success" | "dark";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        size === "sm" && "px-4 py-1.5 text-[13px]",
        size === "md" && "px-[22px] py-[9px] text-sm",
        size === "lg" && "px-[30px] py-[13px] text-[15.5px]",
        // Primary CTA: accent pill with the "3D" bottom shadow
        (variant === "primary" || variant === "success") &&
          "bg-accent font-bold text-on-accent shadow-[0_3px_0_#1F4A36] hover:bg-accent-hover active:translate-y-[2px] active:shadow-[0_1px_0_#1F4A36]",
        // Dark button (nav "Sign in", in-card dark CTA)
        variant === "dark" && "bg-ink font-bold text-bg hover:bg-[#2c3d33]",
        variant === "secondary" && "bg-chip text-ink-soft hover:bg-[#dfe4d5]",
        // Ghost/outline: transparent pill with 1.5px border
        (variant === "outline" || variant === "ghost") &&
          "border-[1.5px] border-border-strong bg-transparent text-ink-soft hover:bg-card",
        variant === "danger" && "bg-red-700 font-bold text-white hover:bg-red-800",
        className
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-[24px] border border-transparent bg-card shadow-[0_12px_40px_rgba(30,43,36,0.08)]",
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "green" | "red" | "amber" | "indigo";
  children: ReactNode;
}) {
  const tones = {
    slate: "bg-chip text-ink-soft",
    green: "bg-green-50 text-accent-deep",
    red: "bg-red-100 text-red-800",
    amber: "bg-amber-100 text-amber-800",
    indigo: "bg-chip text-accent",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[24px] bg-card p-6 shadow-[0_12px_40px_rgba(30,43,36,0.16)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="mb-4 font-display text-lg font-bold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-faint">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label}
    </span>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "w-full rounded-[14px] border-[1.5px] border-border bg-card p-3.5 text-sm text-ink placeholder:text-placeholder focus:border-green-100 focus:bg-input-focus-bg focus:outline-none",
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-[14px] border-[1.5px] border-border bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-placeholder focus:border-green-100 focus:bg-input-focus-bg focus:outline-none",
        className
      )}
      {...props}
    />
  );
}
