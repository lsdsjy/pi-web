import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  HOST_ANTHROPIC_CREDENTIAL_VARS,
  isHostAnthropicCredentialVar,
  stripHostAnthropicCredentials,
} = await createJiti(import.meta.url).import("./host-provider-env.ts");

test("names exactly the three credential variables pi reads for provider auth", () => {
  assert.deepEqual(
    [...HOST_ANTHROPIC_CREDENTIAL_VARS],
    ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  );
});

test("identifies credentials but not unrelated Anthropic variables", () => {
  assert.equal(isHostAnthropicCredentialVar("ANTHROPIC_AUTH_TOKEN", "linux"), true);
  assert.equal(isHostAnthropicCredentialVar("ANTHROPIC_OAUTH_TOKEN", "linux"), true);
  assert.equal(isHostAnthropicCredentialVar("ANTHROPIC_API_KEY", "linux"), true);
  // Pi never reads these for provider registration, and the shells this server
  // starts may still need them.
  assert.equal(isHostAnthropicCredentialVar("ANTHROPIC_BASE_URL", "linux"), false);
  assert.equal(isHostAnthropicCredentialVar("ANTHROPIC_DEFAULT_OPUS_MODEL", "linux"), false);
  assert.equal(isHostAnthropicCredentialVar("CLAUDE_CODE_SUBAGENT_MODEL", "linux"), false);
});

test("matches credential names case-insensitively on Windows only", () => {
  assert.equal(isHostAnthropicCredentialVar("anthropic_auth_token", "win32"), true);
  assert.equal(isHostAnthropicCredentialVar("anthropic_auth_token", "linux"), false);
});

test("removes the credentials in place and reports what it removed", () => {
  const environment = {
    PATH: "/usr/local/bin:/usr/bin",
    ANTHROPIC_AUTH_TOKEN: "proxy-token",
    ANTHROPIC_API_KEY: "sk-host",
    ANTHROPIC_OAUTH_TOKEN: "oauth-host",
    ANTHROPIC_BASE_URL: "https://proxy.example:8443/v1",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-5.5[1m]",
    DEEPSEEK_API_KEY: "kept",
  };

  const removed = stripHostAnthropicCredentials(environment, "linux");

  assert.deepEqual(removed.sort(), ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"]);
  assert.deepEqual(environment, {
    PATH: "/usr/local/bin:/usr/bin",
    ANTHROPIC_BASE_URL: "https://proxy.example:8443/v1",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-5.5[1m]",
    DEEPSEEK_API_KEY: "kept",
  });
});

test("reports nothing and changes nothing when the host exports no credentials", () => {
  const environment = { PATH: "/usr/bin", ANTHROPIC_BASE_URL: "https://proxy.example" };

  assert.deepEqual(stripHostAnthropicCredentials(environment, "linux"), []);
  assert.deepEqual(environment, { PATH: "/usr/bin", ANTHROPIC_BASE_URL: "https://proxy.example" });
});
