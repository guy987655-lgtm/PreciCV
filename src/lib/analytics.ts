"use client";

import posthog from "posthog-js";

let initialized = false;

export function initAnalytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || initialized || typeof window === "undefined") return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: true,
  });
  initialized = true;
}

export function identifyUser(userId: string, email?: string) {
  if (!initialized) return;
  posthog.identify(userId, email ? { email } : undefined);
}

/**
 * PRD §8 — all interactions use one normalized event: 'button_clicked'
 * with properties: button_name, action, button_text, click_source, job_id.
 */
export function trackButtonClick(props: {
  button_name: string;
  action: string;
  button_text: string;
  click_source: string;
  job_id?: string | null;
}) {
  if (!initialized) return;
  posthog.capture("button_clicked", {
    button_name: props.button_name,
    action: props.action,
    button_text: props.button_text,
    click_source: props.click_source,
    job_id: props.job_id ?? null,
  });
}

export function resetAnalytics() {
  if (!initialized) return;
  posthog.reset();
}
