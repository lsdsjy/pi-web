import { NextResponse } from "next/server";
import { resolveSessionPath, openSessionManager } from "@/lib/session-reader";
import { buildSessionOutline } from "@/lib/session-outline";
import { getRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * Turn anchors for the whole active branch, so the chat minimap can show every
 * turn instead of only the page of history the chat has loaded.
 *
 * The response carries no assistant text, tool results, images, or thinking:
 * the outline only has to be accurate about *where* turns are, and it is
 * requested again whenever the branch or the loaded turn count changes.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const leafId = new URL(req.url).searchParams.get("leafId");

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? openSessionManager(filePath!);
    const outline = buildSessionOutline(sm.getEntries() as never, leafId);
    return NextResponse.json(outline, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
