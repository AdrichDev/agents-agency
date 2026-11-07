/**
 * next-builder.ts — runs `next build` inside Docker for the `next` landing path (S8).
 *
 * Owner decision: "Docker sin red". The scaffold produced by `build-next.ts` is written to a
 * fresh temp directory, mounted at `/work` in a local image (`aa-landing-next:1`, built from
 * `docker/landing-next/Dockerfile` with the pinned toolchain preinstalled in
 * `/opt/deps/node_modules`) and compiled with `next build` there. The container gets:
 *
 * - `--network none`: nothing can be downloaded, no callback can be made.
 * - a minimal `env` for the docker CLI itself — the back process env (service-role keys, API
 *   keys, `DATABASE_URL`…) is never forwarded, and the only `-e` is telemetry off.
 * - `--user 1000:1000`, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`,
 *   memory/CPU/pids limits and a tmpfs for `/tmp`, so even a hostile build is bounded.
 * - a 180 s timeout; on timeout the container is killed best effort.
 *
 * The exported site is read back from `/work/out`, and the temp directory is always removed.
 * A missing `docker`/image is a 503 `NEXT_BUILDER_UNAVAILABLE` naming the image command, a
 * failed build a 422 `NEXT_BUILD_FAILED` with a sanitized stderr tail (no host paths, bounded),
 * and an exceeded timeout a 504 `NEXT_BUILD_TIMEOUT`.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HttpError } from "@/lib/http";

/** The local image tag the build runs in; the npm script builds exactly this one. */
export const NEXT_IMAGE = "aa-landing-next:1";
/** The command that creates the image (named in the 503 so the operator can fix it). */
export const NEXT_IMAGE_COMMAND = "npm run landing:next-image";
/** Ceiling for one `next build`, enforced by `execFile` and best-effort by `docker kill`. */
export const NEXT_BUILD_TIMEOUT_MS = 180_000;
/** Non-root uid/gid of the image (`node` in the official Node images). */
const CONTAINER_USER = "1000:1000";
const INSPECT_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 15_000;
const MAX_EXEC_BUFFER = 4 * 1024 * 1024;
/** Ceilings for the exported site read back from the container. */
const MAX_ARTIFACT_FILES = 2_000;
const MAX_ARTIFACT_BYTES = 40 * 1024 * 1024;
/** Bounded, sanitized stderr tail carried in `details`. */
const MAX_ERROR_TAIL_CHARS = 1_200;
const STDERR_WINDOW_CHARS = 8 * 1024;

/**
 * Environment keys the Docker CLI itself needs to find the daemon (`PATH`, the Windows
 * system roots, the Docker context/config). Everything else stays in the back process; the test
 * suite asserts this list is the whole allowlist.
 */
export const DOCKER_ENV_KEYS = [
  "PATH",
  "SystemRoot",
  "SystemDrive",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "TEMP",
  "TMP",
  "LOCALAPPDATA",
  "PROGRAMDATA",
] as const;

/**
 * The in-container build: link the pinned dependencies into the mounted project and build.
 * `PATH` is widened only inside the container, never through `-e`.
 */
const BUILD_SCRIPT = [
  "set -eu",
  "export PATH=/opt/deps/node_modules/.bin:$PATH",
  "ln -sfn /opt/deps/node_modules node_modules",
  "next build",
].join("; ");

/** Only our own scaffold paths are ever written under the temp directory. */
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,200}$/;

function isSafeRelativePath(relative: string): boolean {
  if (!SAFE_RELATIVE_PATH.test(relative) || relative.includes("..")) return false;
  return !relative.split("/").some((segment) => segment === "." || segment === "");
}

interface DockerCall {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
  timedOut: boolean;
}

function dockerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of DOCKER_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function runDocker(args: string[], timeoutMs: number): Promise<DockerCall> {
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      {
        env: dockerEnv(),
        timeout: timeoutMs,
        maxBuffer: MAX_EXEC_BUFFER,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const err = (error ?? undefined) as DockerCall["error"];
        resolve({
          exitCode: error ? (typeof err?.code === "number" ? err.code : null) : 0,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          error: err,
          // `execFile` kills an overrunning child and reports it as killed + signal.
          timedOut: Boolean(err && err.killed && err.signal),
        });
      }
    );
  });
}

function unavailable(reason: string): HttpError {
  return new HttpError(
    503,
    `El build de Next no está disponible en este servidor: crea la imagen con \`${NEXT_IMAGE_COMMAND}\``,
    "NEXT_BUILDER_UNAVAILABLE",
    { command: NEXT_IMAGE_COMMAND, reason }
  );
}

/** True when `docker` and the pinned image are both usable; a 503 otherwise. */
async function assertImageAvailable(): Promise<void> {
  const probe = await runDocker(["image", "inspect", NEXT_IMAGE], INSPECT_TIMEOUT_MS);
  if (probe.timedOut) throw unavailable("docker image inspect timed out");
  if (probe.error !== undefined) {
    throw unavailable(
      probe.error.code === "ENOENT"
        ? "docker is not installed or not on PATH"
        : `docker image inspect ${NEXT_IMAGE} failed`
    );
  }
}

/** The host path of the bind mount, with forward slashes so Docker Desktop parses it. */
function hostPath(dir: string): string {
  return process.platform === "win32" ? dir.replace(/\\/g, "/") : dir;
}

function dockerRunArgs(workDir: string, containerName: string): string[] {
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "--user",
    CONTAINER_USER,
    "--memory",
    "1g",
    "--cpus",
    "1",
    "--pids-limit",
    "256",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=256m",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "-e",
    "NEXT_TELEMETRY_DISABLED=1",
    "-v",
    `${hostPath(workDir)}:/work`,
    "-w",
    "/work",
    NEXT_IMAGE,
    "sh",
    "-c",
    BUILD_SCRIPT,
  ];
}

async function writeTree(dir: string, files: Record<string, Buffer | string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    if (!isSafeRelativePath(relative)) throw new Error(`unsafe scaffold path: ${relative}`);
    const target = path.join(dir, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

/** Bounded read of the exported site (`/work/out`) back into memory. */
async function readExport(outDir: string): Promise<Record<string, Buffer>> {
  const entries: Record<string, Buffer> = {};
  let totalBytes = 0;
  const pending: string[] = [""];
  while (pending.length > 0) {
    const relative = pending.pop() as string;
    const absolute = relative === "" ? outDir : path.join(outDir, ...relative.split("/"));
    const dirents = await fs.readdir(absolute, { withFileTypes: true });
    for (const dirent of dirents) {
      const child = relative === "" ? dirent.name : `${relative}/${dirent.name}`;
      if (dirent.isDirectory()) {
        pending.push(child);
        continue;
      }
      if (!dirent.isFile()) continue; // never follow a symlink out of the export
      if (Object.keys(entries).length >= MAX_ARTIFACT_FILES) {
        throw new HttpError(422, "El build de Next generó demasiados ficheros", "NEXT_BUILD_FAILED", {
          maxFiles: MAX_ARTIFACT_FILES,
        });
      }
      const buffer = await fs.readFile(path.join(outDir, ...child.split("/")));
      totalBytes += buffer.length;
      if (totalBytes > MAX_ARTIFACT_BYTES) {
        throw new HttpError(422, "El build de Next generó demasiado contenido", "NEXT_BUILD_FAILED", {
          maxBytes: MAX_ARTIFACT_BYTES,
        });
      }
      entries[child] = buffer;
    }
  }
  return entries;
}

/** Removes ANSI colors, host paths and the bulk of a docker failure message. */
function sanitize(text: string, workDir: string): string {
  const window = text.length > STDERR_WINDOW_CHARS ? text.slice(-STDERR_WINDOW_CHARS) : text;
  const plain = window
    .replace(/\u001b\[[0-9;]{0,16}m/g, "") // bounded ANSI escape (L8)
    .split(workDir)
    .join("<work>")
    .split(hostPath(workDir))
    .join("<work>")
    .split("\r")
    .join("");
  return plain.length > MAX_ERROR_TAIL_CHARS ? plain.slice(-MAX_ERROR_TAIL_CHARS) : plain;
}

/** Best effort: an overrunning container must not outlive the request that started it. */
async function stopContainer(name: string): Promise<void> {
  await runDocker(["kill", name], KILL_TIMEOUT_MS);
  await runDocker(["rm", "-f", name], KILL_TIMEOUT_MS);
}

async function removeTree(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // A Windows volume can still be held by the daemon right after the container exits; the
    // temp directory is the OS's to reclaim and nothing else can be done here.
  }
}

/**
 * Compiles the scaffold with `next build` in the sandboxed image and returns the exported site
 * (`out/**` relative to the site root, `index.html` at the top). Throws `HttpError` for every
 * failure: 503 unavailable, 422 build failed, 504 timeout.
 */
export async function buildNextSite(
  files: Record<string, Buffer | string>
): Promise<Record<string, Buffer>> {
  await assertImageAvailable();

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "aa-landing-next-"));
  const containerName = `aa-landing-next-${randomBytes(6).toString("hex")}`;
  try {
    await writeTree(workDir, files);
    const run = await runDocker(dockerRunArgs(workDir, containerName), NEXT_BUILD_TIMEOUT_MS);

    if (run.timedOut) {
      await stopContainer(containerName);
      throw new HttpError(
        504,
        `El build de Next superó el límite de ${NEXT_BUILD_TIMEOUT_MS / 1000} s`,
        "NEXT_BUILD_TIMEOUT",
        { timeoutMs: NEXT_BUILD_TIMEOUT_MS }
      );
    }
    if (run.exitCode !== 0) {
      throw new HttpError(422, "No se pudo compilar el proyecto Next", "NEXT_BUILD_FAILED", {
        stderr: sanitize(run.stderr.length > 0 ? run.stderr : run.stdout, workDir),
      });
    }

    const outDir = path.join(workDir, "out");
    try {
      await fs.access(outDir);
    } catch {
      throw new HttpError(422, "El build de Next no generó el sitio exportado", "NEXT_BUILD_FAILED");
    }
    return await readExport(outDir);
  } finally {
    await removeTree(workDir);
  }
}
