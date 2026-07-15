import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot, resolveSafe } from "./workspace.js";

/**
 * Checkpoints capture the pre-edit state of every file the agent touches
 * during a run, so any change can be reverted per-file or all at once.
 * Stored under <workspace>/.katana/checkpoints/<runId>/.
 */

interface FileSnapshot {
  /** Workspace-relative path */
  path: string;
  /** null when the file did not exist before the run */
  before: string | null;
}

interface CheckpointManifest {
  runId: string;
  createdAt: string;
  files: FileSnapshot[];
}

function checkpointDir(runId: string): string {
  return path.join(getWorkspaceRoot(), ".katana", "checkpoints", runId);
}

function manifestPath(runId: string): string {
  return path.join(checkpointDir(runId), "manifest.json");
}

function loadManifest(runId: string): CheckpointManifest {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(runId), "utf8"));
  } catch {
    return { runId, createdAt: new Date().toISOString(), files: [] };
  }
}

function saveManifest(m: CheckpointManifest): void {
  fs.mkdirSync(checkpointDir(m.runId), { recursive: true });
  fs.writeFileSync(manifestPath(m.runId), JSON.stringify(m, null, 2));
}

/** Record a file's current content before the agent modifies it (first write wins). */
export function snapshotBeforeWrite(runId: string, relPath: string): void {
  const m = loadManifest(runId);
  if (m.files.some((f) => f.path === relPath)) return;
  let before: string | null = null;
  try {
    before = fs.readFileSync(resolveSafe(relPath), "utf8");
  } catch {
    before = null;
  }
  m.files.push({ path: relPath, before });
  saveManifest(m);
}

export function getSnapshot(runId: string, relPath: string): FileSnapshot | undefined {
  return loadManifest(runId).files.find((f) => f.path === relPath);
}

/** Restore a single file to its pre-run state. */
export function revertFile(runId: string, relPath: string): void {
  const snap = getSnapshot(runId, relPath);
  if (!snap) throw new Error(`No checkpoint for ${relPath} in run ${runId}`);
  const abs = resolveSafe(relPath);
  if (snap.before === null) {
    fs.rmSync(abs, { force: true });
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, snap.before, "utf8");
  }
}

/** Restore every file touched during the run. */
export function revertRun(runId: string): string[] {
  const m = loadManifest(runId);
  for (const f of m.files) revertFile(runId, f.path);
  return m.files.map((f) => f.path);
}
