import os from "node:os";
import path from "node:path";
import {
  isNodeVersionManagerRuntime,
  resolveLinuxSystemCaBundle,
} from "../bootstrap/node-extra-ca-certs.js";
import { resolveNodeStartupTlsEnvironment } from "../bootstrap/node-startup-env.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { VERSION } from "../version.js";
import {
  GATEWAY_SERVICE_KIND,
  GATEWAY_SERVICE_MARKER,
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
  resolveGatewayWindowsTaskName,
  NODE_SERVICE_KIND,
  NODE_SERVICE_MARKER,
  NODE_WINDOWS_TASK_SCRIPT_NAME,
  resolveNodeLaunchAgentLabel,
  resolveNodeSystemdServiceName,
  resolveNodeWindowsTaskName,
} from "./constants.js";
import { resolveGatewayStateDir } from "./paths.js";

export { isNodeVersionManagerRuntime, resolveLinuxSystemCaBundle };

export type MinimalServicePathOptions = {
  platform?: NodeJS.Platform;
  extraDirs?: string[];
  home?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  existsSync?: (candidate: string) => boolean;
};

type BuildServicePathOptions = MinimalServicePathOptions & {
  env?: Record<string, string | undefined>;
};

type SharedServiceEnvironmentFields = {
  stateDir: string | undefined;
  configPath: string | undefined;
  tmpDir: string;
  minimalPath: string | undefined;
  proxyEnv: Record<string, string | undefined>;
  nodeCaCerts: string | undefined;
  nodeUseSystemCa: string | undefined;
};

export const SERVICE_PROXY_ENV_KEYS = [
  "OPENCLAW_PROXY_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
] as const;

function readServiceProxyEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const proxyUrl = normalizeOptionalString(env.OPENCLAW_PROXY_URL);
  return proxyUrl ? { OPENCLAW_PROXY_URL: proxyUrl } : {};
}

function addCommonUserBinDirs(dirs: string[], home: string): void {
  dirs.push(`${home}/.local/bin`);
  dirs.push(`${home}/.npm-global/bin`);
  dirs.push(`${home}/bin`);
}

function resolveSystemPathDirs(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  }
  if (platform === "linux") {
    return ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  }
  return [];
}

/**
 * Resolve stable personal bin directories for macOS.
 * Toolchain/package-manager dirs are optional and should not be required by the
 * service PATH unless a selected runtime explicitly adds them via extraDirs.
 */
export function resolveDarwinUserBinDirs(home: string | undefined): string[] {
  if (!home) {
    return [];
  }

  const dirs: string[] = [];
  addCommonUserBinDirs(dirs, home);
  return dirs;
}

/**
 * Resolve stable personal bin directories for Linux.
 * Toolchain/package-manager dirs are optional and should not be required by the
 * service PATH unless a selected runtime explicitly adds them via extraDirs.
 */
export function resolveLinuxUserBinDirs(home: string | undefined): string[] {
  if (!home) {
    return [];
  }

  const dirs: string[] = [];
  addCommonUserBinDirs(dirs, home);
  return dirs;
}

export function getMinimalServicePathParts(options: MinimalServicePathOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return [];
  }

  const parts: string[] = [];
  const extraDirs = options.extraDirs ?? [];
  const systemDirs = resolveSystemPathDirs(platform);

  // Add stable personal bin directories. Optional toolchain/package-manager
  // dirs are intentionally excluded unless the selected runtime adds one via
  // extraDirs.
  const userDirs =
    platform === "linux"
      ? resolveLinuxUserBinDirs(options.home)
      : platform === "darwin"
        ? resolveDarwinUserBinDirs(options.home)
        : [];

  const add = (dir: string) => {
    if (!dir) {
      return;
    }
    if (!parts.includes(dir)) {
      parts.push(dir);
    }
  };

  for (const dir of extraDirs) {
    add(dir);
  }
  // User dirs first so user-installed binaries take precedence
  for (const dir of userDirs) {
    add(dir);
  }
  for (const dir of systemDirs) {
    add(dir);
  }

  return parts;
}

export function getMinimalServicePathPartsFromEnv(options: BuildServicePathOptions = {}): string[] {
  const env = options.env ?? process.env;
  return getMinimalServicePathParts({
    ...options,
    home: options.home ?? env.HOME,
    env,
  });
}

export function buildMinimalServicePath(options: BuildServicePathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return env.PATH ?? "";
  }

  return getMinimalServicePathPartsFromEnv({ ...options, env }).join(path.posix.delimiter);
}

export function buildServiceEnvironment(params: {
  env: Record<string, string | undefined>;
  port: number;
  launchdLabel?: string;
  platform?: NodeJS.Platform;
  extraPathDirs?: string[];
  execPath?: string;
}): Record<string, string | undefined> {
  const { env, port, launchdLabel, extraPathDirs } = params;
  const platform = params.platform ?? process.platform;
  const sharedEnv = resolveSharedServiceEnvironmentFields(
    env,
    platform,
    extraPathDirs,
    params.execPath,
  );
  const profile = env.OPENCLAW_PROFILE;
  const wrapperPath = normalizeOptionalString(env.OPENCLAW_WRAPPER);
  const resolvedLaunchdLabel =
    launchdLabel || (platform === "darwin" ? resolveGatewayLaunchAgentLabel(profile) : undefined);
  const systemdUnit = `${resolveGatewaySystemdServiceName(profile)}.service`;
  return {
    ...buildCommonServiceEnvironment(env, sharedEnv),
    OPENCLAW_PROFILE: profile,
    OPENCLAW_WRAPPER: wrapperPath,
    OPENCLAW_GATEWAY_PORT: String(port),
    OPENCLAW_LAUNCHD_LABEL: resolvedLaunchdLabel,
    OPENCLAW_SYSTEMD_UNIT: systemdUnit,
    OPENCLAW_WINDOWS_TASK_NAME: resolveGatewayWindowsTaskName(profile),
    OPENCLAW_SERVICE_MARKER: GATEWAY_SERVICE_MARKER,
    OPENCLAW_SERVICE_KIND: GATEWAY_SERVICE_KIND,
    OPENCLAW_SERVICE_VERSION: VERSION,
  };
}

export function buildNodeServiceEnvironment(params: {
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  extraPathDirs?: string[];
  execPath?: string;
}): Record<string, string | undefined> {
  const { env, extraPathDirs } = params;
  const platform = params.platform ?? process.platform;
  const sharedEnv = resolveSharedServiceEnvironmentFields(
    env,
    platform,
    extraPathDirs,
    params.execPath,
  );
  const gatewayToken = normalizeOptionalString(env.OPENCLAW_GATEWAY_TOKEN);
  const allowInsecurePrivateWs = normalizeOptionalString(env.OPENCLAW_ALLOW_INSECURE_PRIVATE_WS);
  return {
    ...buildCommonServiceEnvironment(env, sharedEnv),
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: allowInsecurePrivateWs,
    OPENCLAW_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    OPENCLAW_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    OPENCLAW_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    OPENCLAW_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    OPENCLAW_LOG_PREFIX: "node",
    OPENCLAW_SERVICE_MARKER: NODE_SERVICE_MARKER,
    OPENCLAW_SERVICE_KIND: NODE_SERVICE_KIND,
    OPENCLAW_SERVICE_VERSION: VERSION,
  };
}

function buildCommonServiceEnvironment(
  env: Record<string, string | undefined>,
  sharedEnv: SharedServiceEnvironmentFields,
): Record<string, string | undefined> {
  const serviceEnv: Record<string, string | undefined> = {
    HOME: env.HOME,
    TMPDIR: sharedEnv.tmpDir,
    NODE_EXTRA_CA_CERTS: sharedEnv.nodeCaCerts,
    NODE_USE_SYSTEM_CA: sharedEnv.nodeUseSystemCa,
    OPENCLAW_STATE_DIR: sharedEnv.stateDir,
    OPENCLAW_CONFIG_PATH: sharedEnv.configPath,
    ...sharedEnv.proxyEnv,
  };
  if (sharedEnv.minimalPath) {
    serviceEnv.PATH = sharedEnv.minimalPath;
  }
  return serviceEnv;
}

function resolveServiceTmpDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string {
  if (platform === "darwin") {
    try {
      return path.join(resolveGatewayStateDir(env), "tmp");
    } catch {
      return env.TMPDIR?.trim() || os.tmpdir();
    }
  }
  return env.TMPDIR?.trim() || os.tmpdir();
}

function resolveSharedServiceEnvironmentFields(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  extraPathDirs: string[] | undefined,
  execPath?: string,
): SharedServiceEnvironmentFields {
  const stateDir = env.OPENCLAW_STATE_DIR;
  const configPath = env.OPENCLAW_CONFIG_PATH;
  const tmpDir = resolveServiceTmpDir(env, platform);
  // On macOS, launchd services don't inherit the shell environment, so Node's undici/fetch
  // cannot locate the system CA bundle. Default to /etc/ssl/cert.pem so TLS verification
  // works correctly when running as a LaunchAgent without extra user configuration.
  // On Linux, nvm-installed Node may need the host CA bundle injected before startup.
  const startupTlsEnv = resolveNodeStartupTlsEnvironment({
    env,
    platform,
    execPath,
  });
  return {
    stateDir,
    configPath,
    tmpDir,
    // On Windows, Scheduled Tasks should inherit the current task PATH instead of
    // freezing the install-time snapshot into gateway.cmd/node-host.cmd.
    minimalPath:
      platform === "win32"
        ? undefined
        : buildMinimalServicePath({ env, platform, extraDirs: extraPathDirs }),
    proxyEnv: readServiceProxyEnvironment(env),
    nodeCaCerts: startupTlsEnv.NODE_EXTRA_CA_CERTS,
    nodeUseSystemCa: startupTlsEnv.NODE_USE_SYSTEM_CA,
  };
}
