import { InterviewTone } from "@/lib/types";

/**
 * Interview-tone metadata. Each simulated question is asked in one of three
 * tones; the label, chip color and coaching hint frame how to handle it.
 * (The former comic-style illustrations were removed for a cleaner,
 * more professional look — this now carries only the textual cues.)
 */
export const TONE_META: Record<
  InterviewTone,
  { label: string; chip: string; hint: string }
> = {
  friendly: {
    label: "Friendly opener",
    chip: "#2F6B4F",
    hint: "Warm tone — build rapport, smile back.",
  },
  curious: {
    label: "Digging deeper",
    chip: "#B07D2B",
    hint: "They want specifics — bring numbers.",
  },
  challenging: {
    label: "Pressure test",
    chip: "#B04A3A",
    hint: "Stay calm and concrete — don't get defensive.",
  },
};
