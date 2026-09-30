import { jsonResponse } from "@/lib/json-response";
import { isValidSessionId } from "@/lib/pinned-sessions";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { ArchiveRestoreError, listArchivedSessions, restoreArchivedSession } from "@/lib/session-archive";
import { invalidateSessionListCache, invalidateSessionPathCache } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(request: Request, error: string, status: number): Response {
  return jsonResponse(request, { error }, { status, headers: NO_STORE });
}

// GET /api/sessions/archived — archived sessions, most recently archived first.
export async function GET(request: Request) {
  try {
    return jsonResponse(request, { sessions: await listArchivedSessions() }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(request, error instanceof Error ? error.message : String(error), 500);
  }
}

// POST /api/sessions/archived { sessionId } — restores an archived session
// (and its archived subagent sessions) into ~/.pi/agent/sessions/.
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return errorResponse(request, "Untrusted API request", 403);
  }
  if (!hasJsonContentType(request)) {
    return errorResponse(request, "Content-Type must be application/json", 415);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(request, "Invalid JSON body", 400);
  }
  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId;
  if (!isValidSessionId(sessionId)) {
    return errorResponse(request, "Body must be { sessionId: string }", 400);
  }
  try {
    const { restoredPaths } = restoreArchivedSession(sessionId);
    for (const id of Object.keys(restoredPaths)) invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return jsonResponse(request, { ok: true, restoredPaths }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ArchiveRestoreError) return errorResponse(request, error.message, error.status);
    return errorResponse(request, error instanceof Error ? error.message : String(error), 500);
  }
}
