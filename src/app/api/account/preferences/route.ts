import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CV_TEMPLATES } from "@/lib/types";

/**
 * Account-level preferences the funnel needs the moment it mounts: the design
 * the user last downloaded, and whether they have a base CV on file.
 *
 * One route for both because the landing page needs both at the same instant
 * (on hydrate) — splitting them would cost a second round trip on the page
 * users see first.
 */

const BodySchema = z.object({
  defaultTemplate: z.enum(CV_TEMPLATES).optional(),
  /** null forgets the saved CV; an object replaces it. */
  baseCv: z
    .object({
      rawText: z.string().min(1).max(200_000),
      fileName: z.string().min(1).max(255),
    })
    .nullable()
    .optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("default_template, cv_file_name, cv_uploaded_at, raw_cv_text")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A saved CV is only offerable when its TEXT survived — the file name alone
  // would render a card that cannot actually be analyzed.
  const hasText = Boolean(data?.raw_cv_text?.trim());
  return NextResponse.json({
    defaultTemplate: data?.default_template ?? null,
    baseCv: hasText
      ? {
          fileName: data?.cv_file_name ?? "Your CV",
          uploadedAt: data?.cv_uploaded_at ?? null,
        }
      : null,
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { defaultTemplate, baseCv } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (defaultTemplate) patch.default_template = defaultTemplate;
  if (baseCv === null) {
    patch.raw_cv_text = null;
    patch.cv_file_name = null;
    patch.cv_uploaded_at = null;
  } else if (baseCv) {
    patch.raw_cv_text = baseCv.rawText;
    patch.cv_file_name = baseCv.fileName;
    patch.cv_uploaded_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  // Upsert, not update: a user who came through the anonymous funnel and
  // signed up may not have a profiles row until /api/try/import runs.
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { user_id: user.id, email: user.email, ...patch },
      { onConflict: "user_id" }
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
