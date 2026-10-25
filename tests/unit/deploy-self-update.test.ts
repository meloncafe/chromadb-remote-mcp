import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * deploy.sh `self-update` — replaces the repository-managed files (deploy.sh, compose files,
 * .env.example) from a release tag, never touching .env, local overrides or data.
 *
 * The real deploy.sh is copied into a throwaway install directory and run against a fake
 * release laid out as <releaseRoot>/<owner>/<repo>/<tag>/<file> and served through file://
 * URLs (DEPLOY_RAW_BASE / DEPLOY_API_BASE), so no network and no docker are involved.
 * Failure injection (rollback path) uses a PATH shim inside the temp directory.
 */

const REPO = "acme/sample-repo";
const TAG_OLD = "v1.0.0";
const TAG_NEW = "v2.0.0";
const ORIGINAL_DEPLOY = "#!/usr/bin/env bash\necho original-deploy\n";
const ORIGINAL_COMPOSE = "services:\n  app:\n    image: original/app:1\n";
const ORIGINAL_TRAEFIK_EXAMPLE = "services:\n  proxy:\n    image: original/proxy:1\n";
const ORIGINAL_ENV_EXAMPLE = "ORIGINAL_EXAMPLE=1\n";
const RELEASE_DEPLOY = "#!/usr/bin/env bash\necho release-deploy\n";
const RELEASE_COMPOSE = "services:\n  app:\n    image: release/app:2\n";
const RELEASE_TRAEFIK_EXAMPLE = "services:\n  proxy:\n    image: release/proxy:2\n";
const RELEASE_ENV_EXAMPLE = "RELEASE_EXAMPLE=2\n";
const ENV_SECRET = "SECRET_TOKEN=do-not-touch\n";
const LOCAL_OVERRIDE = "services:\n  app:\n    labels:\n      local: override\n";
const DATA_FILE_CONTENT = "chroma-data-bytes";

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

const sha256 = (content: string | Buffer): string => createHash("sha256").update(content).digest("hex");

describe("deploy.sh self-update", () => {
  let root = "";
  let installDir = "";
  let releaseRoot = "";
  const realDeploy = join(process.cwd(), "deploy.sh");

  const releaseDir = (tag: string): string => join(releaseRoot, REPO, tag);

  const writeRelease = (tag: string, files: Record<string, string>): void => {
    const dir = releaseDir(tag);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
  };

  const fullRelease = (): Record<string, string> => ({
    "deploy.sh": RELEASE_DEPLOY,
    "docker-compose.yml": RELEASE_COMPOSE,
    "docker-compose.traefik.example.yml": RELEASE_TRAEFIK_EXAMPLE,
    ".env.example": RELEASE_ENV_EXAMPLE,
  });

  const read = (name: string): string => readFileSync(join(installDir, name), "utf-8");

  /** Relative path -> sha256 (or "<dir>") for everything below the install directory. */
  const snapshot = (): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          out[rel] = "<dir>";
          walk(join(dir, entry.name), rel);
        } else {
          out[rel] = sha256(readFileSync(join(dir, entry.name)));
        }
      }
    };
    walk(installDir, "");
    return out;
  };

  const run = (args: string[], env: Record<string, string> = {}, pathPrefix = ""): RunResult => {
    const basePath = process.env.PATH ?? "/usr/bin:/bin";
    const result = spawnSync("bash", [join(installDir, "deploy.sh"), ...args], {
      cwd: installDir,
      encoding: "utf-8",
      timeout: 20000,
      env: {
        PATH: pathPrefix === "" ? basePath : `${pathPrefix}:${basePath}`,
        HOME: root,
        DEPLOY_LANG: "en",
        DEPLOY_RAW_BASE: `file://${releaseRoot}`,
        DEPLOY_API_BASE: `file://${releaseRoot}/api`,
        DEPLOY_REPO: REPO,
        ...env,
      },
    });
    const stdout = (result.stdout ?? "").replace(ANSI, "");
    const stderr = (result.stderr ?? "").replace(ANSI, "");
    return { status: result.status, stdout, stderr, output: `${stdout}\n${stderr}` };
  };

  const leftovers = (): string[] =>
    readdirSync(installDir).filter(
      (n) => n.startsWith(".self-update.") || n.includes(".new.") || n.includes(".rb."),
    );

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "deploy-self-update-"));
    installDir = join(root, "install");
    releaseRoot = join(root, "release");
    mkdirSync(installDir, { recursive: true });
    mkdirSync(releaseRoot, { recursive: true });

    copyFileSync(realDeploy, join(installDir, "deploy.sh"));
    chmodSync(join(installDir, "deploy.sh"), 0o755);
    // Distinguishable "installed" content: append a marker so the copy differs from any release.
    writeFileSync(join(installDir, "deploy.sh"), readFileSync(realDeploy, "utf-8") + "\n# installed-marker\n");
    writeFileSync(join(installDir, "docker-compose.yml"), ORIGINAL_COMPOSE);
    writeFileSync(join(installDir, "docker-compose.traefik.example.yml"), ORIGINAL_TRAEFIK_EXAMPLE);
    writeFileSync(join(installDir, ".env.example"), ORIGINAL_ENV_EXAMPLE);
    writeFileSync(join(installDir, ".env"), ENV_SECRET);
    writeFileSync(join(installDir, "docker-compose.traefik.yml"), LOCAL_OVERRIDE);
    writeFileSync(join(installDir, ".deploy-release"), `${TAG_OLD}\n`);
    mkdirSync(join(installDir, "data", "chroma"), { recursive: true });
    writeFileSync(join(installDir, "data", "chroma", "chroma.sqlite3"), DATA_FILE_CONTENT);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const expectUntouchedUserFiles = (): void => {
    expect(read(".env")).toBe(ENV_SECRET);
    expect(read("docker-compose.traefik.yml")).toBe(LOCAL_OVERRIDE);
    expect(readFileSync(join(installDir, "data", "chroma", "chroma.sqlite3"), "utf-8")).toBe(DATA_FILE_CONTENT);
  };

  it("DRY_RUN prints the plan and changes nothing", () => {
    writeRelease(TAG_NEW, fullRelease());
    const before = snapshot();

    const result = run(["self-update", TAG_NEW], { DRY_RUN: "1" });

    expect(result.status).toBe(0);
    expect(result.output).toContain("[DRY-RUN]");
    expect(result.output).toContain(`current ${TAG_OLD} -> target ${TAG_NEW}`);
    expect(snapshot()).toEqual(before);
    expect(existsSync(join(installDir, "backups"))).toBe(false);
  });

  it("replaces the managed files, records the tag and backs up the previous files", () => {
    writeRelease(TAG_NEW, fullRelease());
    const previousDeploy = read("deploy.sh");

    const result = run(["self-update", TAG_NEW]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("Self-update complete");
    expect(read("deploy.sh")).toBe(RELEASE_DEPLOY);
    expect(read("docker-compose.yml")).toBe(RELEASE_COMPOSE);
    expect(read("docker-compose.traefik.example.yml")).toBe(RELEASE_TRAEFIK_EXAMPLE);
    expect(read(".env.example")).toBe(RELEASE_ENV_EXAMPLE);
    expect(read(".deploy-release").trim()).toBe(TAG_NEW);
    expect(statSync(join(installDir, "deploy.sh")).mode & 0o111).not.toBe(0);
    expect(leftovers()).toEqual([]);

    const backups = readdirSync(join(installDir, "backups"));
    expect(backups).toHaveLength(1);
    const backupDir = join(installDir, "backups", backups[0] as string);
    expect(backups[0]).toContain(`_${TAG_OLD}`);
    expect(readFileSync(join(backupDir, "deploy.sh"), "utf-8")).toBe(previousDeploy);
    expect(readFileSync(join(backupDir, "docker-compose.yml"), "utf-8")).toBe(ORIGINAL_COMPOSE);

    expectUntouchedUserFiles();
  });

  it("skips a release file that is not published (optional file) and keeps the local copy", () => {
    writeRelease(TAG_NEW, {
      "deploy.sh": RELEASE_DEPLOY,
      "docker-compose.yml": RELEASE_COMPOSE,
    });

    const result = run(["self-update", TAG_NEW]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("skipped: docker-compose.traefik.example.yml");
    expect(read("docker-compose.yml")).toBe(RELEASE_COMPOSE);
    expect(read("docker-compose.traefik.example.yml")).toBe(ORIGINAL_TRAEFIK_EXAMPLE);
    expect(read(".env.example")).toBe(ORIGINAL_ENV_EXAMPLE);
    expectUntouchedUserFiles();
  });

  it("is a no-op when already at the target tag, and reinstalls with SELF_UPDATE_FORCE=1", () => {
    writeRelease(TAG_OLD, fullRelease());
    const before = snapshot();

    const skipped = run(["self-update", TAG_OLD]);

    expect(skipped.status).toBe(0);
    expect(skipped.output).toContain(`Already at ${TAG_OLD}`);
    expect(snapshot()).toEqual(before);

    const forced = run(["self-update", TAG_OLD], { SELF_UPDATE_FORCE: "1" });

    expect(forced.status).toBe(0);
    expect(forced.output).toContain("Self-update complete");
    expect(read("docker-compose.yml")).toBe(RELEASE_COMPOSE);
  });

  it("rejects a tag that does not exist and leaves everything as it was", () => {
    const before = snapshot();

    const result = run(["self-update", "v9.9.9"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Required file missing from v9.9.9");
    expect(snapshot()).toEqual(before);
    expect(leftovers()).toEqual([]);
  });

  it("rejects a downloaded deploy.sh with a syntax error and replaces none of the files", () => {
    writeRelease(TAG_NEW, { ...fullRelease(), "deploy.sh": "#!/usr/bin/env bash\nif then fi (\n" });
    const before = snapshot();

    const result = run(["self-update", TAG_NEW]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Shell syntax error: deploy.sh");
    expect(snapshot()).toEqual(before);
    expect(read(".deploy-release").trim()).toBe(TAG_OLD);
  });

  it("rejects an empty download, a script without shebang and a compose file without services", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ ...fullRelease(), "docker-compose.yml": "" }, "Empty download: docker-compose.yml"],
      [{ ...fullRelease(), "deploy.sh": "echo no shebang\n" }, "Not a script (no shebang): deploy.sh"],
      [{ ...fullRelease(), "docker-compose.yml": "version: '3'\n" }, "Not a compose file (no services:): docker-compose.yml"],
    ];
    const before = snapshot();

    cases.forEach(([files, message], index) => {
      const tag = `bad${index}`;
      writeRelease(tag, files);

      const result = run(["self-update", tag]);

      expect(result.status).toBe(1);
      expect(result.output).toContain(message);
      expect(snapshot()).toEqual(before);
    });
  });

  it("rejects a SHA256SUMS mismatch and keeps the originals", () => {
    writeRelease(TAG_NEW, {
      ...fullRelease(),
      SHA256SUMS: `${sha256(RELEASE_DEPLOY)}  deploy.sh\n${sha256("tampered")}  docker-compose.yml\n`,
    });
    const before = snapshot();

    const result = run(["self-update", TAG_NEW]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("sha256 mismatch: docker-compose.yml");
    expect(snapshot()).toEqual(before);
  });

  it("accepts a matching SHA256SUMS", () => {
    writeRelease(TAG_NEW, {
      ...fullRelease(),
      SHA256SUMS:
        `${sha256(RELEASE_DEPLOY)}  deploy.sh\n` +
        `${sha256(RELEASE_COMPOSE)}  docker-compose.yml\n` +
        `${sha256(RELEASE_TRAEFIK_EXAMPLE)}  docker-compose.traefik.example.yml\n` +
        `${sha256(RELEASE_ENV_EXAMPLE)}  .env.example\n`,
    });

    const result = run(["self-update", TAG_NEW]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("sha256 verified: 4 file(s)");
    expect(read("docker-compose.yml")).toBe(RELEASE_COMPOSE);
  });

  it("rolls back every already-replaced file when a later replacement fails", () => {
    writeRelease(TAG_NEW, fullRelease());
    const previousDeploy = read("deploy.sh");

    // `chmod` shim: fails for the staged compose file (the 2nd file replaced) and, at that
    // moment, snapshots deploy.sh so the test can prove it had already been swapped.
    const shimDir = join(root, "shim");
    const midFlight = join(root, "deploy.sh.midflight");
    mkdirSync(shimDir, { recursive: true });
    const shim = join(shimDir, "chmod");
    writeFileSync(
      shim,
      [
        "#!/bin/sh",
        'for a in "$@"; do',
        '  case "$a" in',
        "    *docker-compose.yml.new.*)",
        '      cp "$SHIM_WATCH" "$SHIM_LOG"',
        "      exit 1",
        "      ;;",
        "  esac",
        "done",
        'PATH="$SHIM_REAL_PATH"',
        'exec chmod "$@"',
        "",
      ].join("\n"),
    );
    chmodSync(shim, 0o755);

    const result = run(
      ["self-update", TAG_NEW],
      {
        SHIM_WATCH: join(installDir, "deploy.sh"),
        SHIM_LOG: midFlight,
        SHIM_REAL_PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
      shimDir,
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain("Replace failed: docker-compose.yml; rolling back");
    // Proof the failure happened after deploy.sh was already replaced ...
    expect(readFileSync(midFlight, "utf-8")).toBe(RELEASE_DEPLOY);
    // ... and that the rollback restored it, byte for byte.
    expect(read("deploy.sh")).toBe(previousDeploy);
    expect(read("docker-compose.yml")).toBe(ORIGINAL_COMPOSE);
    expect(read("docker-compose.traefik.example.yml")).toBe(ORIGINAL_TRAEFIK_EXAMPLE);
    expect(read(".env.example")).toBe(ORIGINAL_ENV_EXAMPLE);
    expect(read(".deploy-release").trim()).toBe(TAG_OLD);
    expect(leftovers()).toEqual([]);
    expectUntouchedUserFiles();
  });

  it("refuses to run in a git checkout", () => {
    writeRelease(TAG_NEW, fullRelease());
    writeFileSync(join(installDir, ".git"), "gitdir: elsewhere\n");
    const before = snapshot();

    const result = run(["self-update", TAG_NEW]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("This is a git checkout");
    expect(snapshot()).toEqual(before);
  });

  it("rejects malformed tags", () => {
    const before = snapshot();

    for (const tag of ["../escape", "v1/../x", "-bad", "a b"]) {
      const result = run(["self-update", tag]);
      expect(result.status).toBe(1);
      expect(snapshot()).toEqual(before);
    }
  });

  it("refuses unsafe SELF_UPDATE_FILES entries and never replaces .env", () => {
    writeRelease(TAG_NEW, { ...fullRelease(), ".env": "SECRET_TOKEN=from-release\n" });
    const before = snapshot();

    for (const files of ["deploy.sh .env", "deploy.sh ../outside", "sub/dir.yml"]) {
      const result = run(["self-update", TAG_NEW], { SELF_UPDATE_FILES: files });
      expect(result.status).toBe(1);
      expect(result.output).toContain("Refusing unsafe file name");
      expect(snapshot()).toEqual(before);
    }
  });

  it("honours SELF_UPDATE_FILES as the replacement allow-list", () => {
    writeRelease(TAG_NEW, fullRelease());

    const result = run(["self-update", TAG_NEW], { SELF_UPDATE_FILES: "deploy.sh docker-compose.yml" });

    expect(result.status).toBe(0);
    expect(read("docker-compose.yml")).toBe(RELEASE_COMPOSE);
    expect(read(".env.example")).toBe(ORIGINAL_ENV_EXAMPLE);
    expect(read("docker-compose.traefik.example.yml")).toBe(ORIGINAL_TRAEFIK_EXAMPLE);
  });

  it("takes the tag from --tag, --tag=, or DEPLOY_TAG", () => {
    writeRelease(TAG_NEW, fullRelease());

    expect(run(["self-update", "--tag", TAG_NEW], { DRY_RUN: "1" }).output).toContain(`target ${TAG_NEW}`);
    expect(run(["self-update", `--tag=${TAG_NEW}`], { DRY_RUN: "1" }).output).toContain(`target ${TAG_NEW}`);
    expect(run(["self-update"], { DRY_RUN: "1", DEPLOY_TAG: TAG_NEW }).output).toContain(`target ${TAG_NEW}`);
    expect(run(["self-update", "--unknown"], { DRY_RUN: "1" }).status).toBe(1);
  });

  it("resolves the latest release tag from the (fake) releases API when no tag is given", () => {
    writeRelease(TAG_NEW, fullRelease());
    const apiDir = join(releaseRoot, "api", "repos", REPO, "releases");
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, "latest"), `{"id": 1, "tag_name": "${TAG_NEW}", "draft": false}\n`);

    const result = run(["self-update"]);

    expect(result.status).toBe(0);
    expect(read(".deploy-release").trim()).toBe(TAG_NEW);
    expect(read("docker-compose.yml")).toBe(RELEASE_COMPOSE);
  });

  it("fails clearly when the latest tag cannot be resolved", () => {
    const before = snapshot();

    const result = run(["self-update"]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Cannot resolve the latest release tag");
    expect(snapshot()).toEqual(before);
  });

  it("works without a compose file or .env (repair path)", () => {
    writeRelease(TAG_NEW, fullRelease());
    rmSync(join(installDir, "docker-compose.yml"));
    rmSync(join(installDir, ".env"));
    rmSync(join(installDir, ".deploy-release"));

    const result = run(["self-update", TAG_NEW]);

    expect(result.status).toBe(0);
    expect(result.output).toContain(`current unknown -> target ${TAG_NEW}`);
    expect(read("docker-compose.yml")).toBe(RELEASE_COMPOSE);
    expect(existsSync(join(installDir, ".env"))).toBe(false);
  });
});
