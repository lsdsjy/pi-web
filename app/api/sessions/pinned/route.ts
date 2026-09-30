import { jsonResponse } from "@/lib/json-response";
import { MAX_PINNED_SESSIONS, parsePinnedSessionIds } from "@/lib/pinned-sessions";
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

// PUT /api/sessions/pinned { sessionIds } — replaces the whole list.
export async function PUT(request: Request) {
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
  const sessionIds = parsePinnedSessionIds((body as { sessionIds?: unknown } | null)?.sessionIds);
  if (!sessionIds) {
    return errorResponse(
      request,
      `sessionIds must be an array of at most ${MAX_PINNED_SESSIONS} session id strings`,
      400,
    );
  }

  try {
    return jsonResponse(request, { sessionIds: writePinnedSessionIds(sessionIds) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(request, error instanceof Error ? error.message : String(error), 500);
  }
}
