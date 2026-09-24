/**
 * Anthropic credential variables that belong to the host shell, not to pi.
 *
 * Pi resolves its built-in `anthropic` provider from `ANTHROPIC_AUTH_TOKEN`,
 * `ANTHROPIC_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` in the process environment,
 * and lists the provider as signed in as soon as one of them is set. A host
 * shell that exports them for its own tools (Claude Code, `claude` aliases,
 * an internal proxy) therefore leaks an Anthropic provider into every pi
 * session this server runs — pointing at `api.anthropic.com` with a token that
 * only works against the host's proxy, so the models appear in the picker and
 * fail on the first request.
 *
 * This server drops those three names from its own process environment before
 * any pi model runtime reads it. Only the environment is ignored:
 *
 *   - a provider configured in `~/.pi/agent/models.json` keeps working, since
 *     it carries its own `baseUrl` and key;
 *   - a credential stored through `/login` in `auth.json` keeps working;
 *   - `ANTHROPIC_BASE_URL` is left alone. Pi does not read it (only Claude Code
 *     does), so it cannot register a provider, and the shells and commands this
 *     server starts may still want it.
 */

export const HOST_ANTHROPIC_CREDENTIAL_VARS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
] as const;

function comparableName(name: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? name.toUpperCase() : name;
}

/** Whether one environment variable name is a host Anthropic credential. */
export function isHostAnthropicCredentialVar(
  name: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const target = comparableName(name, platform);
  return HOST_ANTHROPIC_CREDENTIAL_VARS.some(
    (candidate) => comparableName(candidate, platform) === target,
  );
}

/**
 * Delete every host Anthropic credential from `environment` in place and return
 * the names that were removed, so the caller can log what it ignored.
 */
export function stripHostAnthropicCredentials(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const removed: string[] = [];
  for (const name of Object.keys(environment)) {
    if (!isHostAnthropicCredentialVar(name, platform)) continue;
    delete environment[name];
    removed.push(name);
  }
  return removed;
}
