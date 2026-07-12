import { NextResponse } from "next/server";
import { z } from "zod";
import { rewriteSnippet, llmConfigured, LLM_NOT_CONFIGURED_MSG } from "@/lib/llm";

export const maxDuration = 60;

const BodySchema = z.object({
  text: z.string().min(1).max(2000),
  length: z.enum(["short", "long", "default"]).default("default"),
  context: z.string().max(200).optional(),
  jdText: z.string().max(30000).optional(),
});

/**
 * Anonymous funnel: rewrites a single highlighted CV snippet. Stateless — the
 * per-flow rewrite quota is tracked client-side (localStorage). Nothing is
 * stored server-side.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  try {
    const text = await rewriteSnippet(parsed.data.text, {
      length: parsed.data.length,
      context: parsed.data.context,
      jdText: parsed.data.jdText,
    });
    return NextResponse.json({ text });
  } catch (e) {
    console.error("try/rewrite failed:", e);
    return NextResponse.json(
      { error: "Rewrite failed. Please try again in a moment." },
      { status: 502 }
    );
  }
}
