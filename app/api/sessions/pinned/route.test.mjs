import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-pinned-sessions-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;
const pinnedPath = join(testAgentDir, "pi-web", "pinned-sessions.json");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function getRequest() {
  return new Request("http://localhost/api/sessions/pinned", { headers: { Host: "localhost" } });
}

function putRequest(body, contentType = "application/json") {
  return new Request("http://localhost/api/sessions/pinned", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("pinned route starts empty and persists the list in order", async () => {
  let response = await GET(getRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { sessionIds: [] });

  response = await PUT(putRequest({ sessionIds: ["b", "a", "b"] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sessionIds: ["b", "a"] });
  assert.deepEqual(JSON.parse(await readFile(pinnedPath, "utf8")), { sessionIds: ["b", "a"] });

  response = await GET(getRequest());
  assert.deepEqual(await response.json(), { sessionIds: ["b", "a"] });
});

test("pinned route validates the body", async () => {
  for (const body of [{}, { sessionIds: "a" }, { sessionIds: [1] }, { sessionIds: [""] }, { sessionIds: Array.from({ length: 501 }, (_, i) => `s${i}`) }, null]) {
    const response = await PUT(putRequest(body));
    assert.equal(response.status, 400, JSON.stringify(body)?.slice(0, 40));
    assert.match((await response.json()).error, /sessionIds must be an array/);
  }

  let response = await PUT(putRequest("{not json"));
  assert.equal(response.status, 400);

  response = await PUT(putRequest({ sessionIds: [] }, "text/plain"));
  assert.equal(response.status, 415);

  response = await GET(getRequest());
  assert.deepEqual(await response.json(), { sessionIds: ["b", "a"] });
});

test("pinned route reads a damaged file as no pins and keeps valid entries", async () => {
  await mkdir(join(testAgentDir, "pi-web"), { recursive: true });
  await writeFile(pinnedPath, "{broken");
  let response = await GET(getRequest());
  assert.deepEqual(await response.json(), { sessionIds: [] });

  await writeFile(pinnedPath, JSON.stringify({ sessionIds: ["x", 3, "x", "y"] }));
  response = await GET(getRequest());
  assert.deepEqual(await response.json(), { sessionIds: ["x", "y"] });
});
