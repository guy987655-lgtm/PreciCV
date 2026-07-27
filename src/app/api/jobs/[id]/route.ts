import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/** Matches the rename cap the History page enforces client-side. */
const MAX_DISPLAY_NAME = 50;

const PatchSchema = z.object({
  /** "" clears the rename and restores the derived title · company label. */
  displayName: z.string().max(MAX_DISPLAY_NAME).optional(),
  /** Undo for a soft delete — only ever sent as null (restore). */
  deletedAt: z.null().optional(),
});

/** Rename a job, or restore one that was soft-deleted (Undo). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = PatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { displayName, deletedAt } = parsed.data;

  const patch: Record<string, string | null> = {};
  if (displayName !== undefined) {
    patch.display_name = displayName.trim().slice(0, MAX_DISPLAY_NAME) || null;
  }
  if (deletedAt === null && "deletedAt" in parsed.data) patch.deleted_at = null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // The user_id filter is belt-and-braces next to RLS: it turns someone
  // else's job id into a plain 404 instead of a silent no-op.
  const { data, error } = await supabase
    .from("jobs")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, display_name, deleted_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id,
    displayName: data.display_name ?? "",
    deleted: Boolean(data.deleted_at),
  });
}

/**
 * Soft-deletes a job: it disappears from History while the job, its
 * generations and — crucially — its purchase row survive, so a paid-for
 * document is never destroyed by a misclick and refunds stay traceable.
 * PATCH { deletedAt: null } restores it (the Undo toast).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("jobs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
