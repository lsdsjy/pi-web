import { jsonResponse } from "@/lib/json-response";
import { isValidSessionId, setSessionPinned } from "@/lib/pinned-sessions";
import { readPinnedSessionIds, writePinnedSessionIds } from "@/lib/pinned-sessions-store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(request: Request, error: string, status: number): Response {
  return jsonResponse(request, { error }, { status, headers: NO_STORE });
}

// GET /api/sessions/pinned — pinned session ids, most recently pinned first.
export async function GET(request: Request) {
  try {
    return jsonResponse(request, { sessionIds: readPinnedSessionIds() }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(request, error instanceof Error ? error.message : String(error), 500);
  }
}

// PATCH /api/sessions/pinned { sessionId, pinned } — pins (moves to the front)
// or unpins one session and returns the whole list. Changes are merged here
// rather than sent as a full list, so two clients (the desktop shell and a
// browser tab) cannot overwrite each other's pins with a stale copy.
export async function PATCH(request: Request) {
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
  const { sessionId, pinned } = (body ?? {}) as { sessionId?: unknown; pinned?: unknown };
  if (!isValidSessionId(sessionId) || typeof pinned !== "boolean") {
    return errorResponse(request, "Body must be { sessionId: string, pinned: boolean }", 400);
  }

  try {
    // Read and write are synchronous, so concurrent requests cannot interleave.
    const next = setSessionPinned(readPinnedSessionIds(), sessionId, pinned);
    return jsonResponse(request, { sessionIds: writePinnedSessionIds(next) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(request, error instanceof Error ? error.message : String(error), 500);
  }
}
