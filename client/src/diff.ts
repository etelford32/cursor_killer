// Minimal line diff for rendering agent edits as unified diffs.

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

const MAX_DP_LINES = 400;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  // Trim common prefix/suffix so the DP only runs on the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same" as const, text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ kind: "same" as const, text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let middle: DiffLine[];
  if (midA.length === 0 && midB.length === 0) {
    middle = [];
  } else if (midA.length > MAX_DP_LINES || midB.length > MAX_DP_LINES) {
    // Too large for LCS — render as a block replace.
    middle = [
      ...midA.map((text) => ({ kind: "del" as const, text })),
      ...midB.map((text) => ({ kind: "add" as const, text })),
    ];
  } else {
    middle = lcsDiff(midA, midB);
  }

  return [...head, ...middle, ...tail];
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}

/** Collapse long unchanged stretches for display, keeping context around changes. */
export function collapseContext(lines: DiffLine[], context = 3): (DiffLine | { kind: "skip"; count: number })[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.kind !== "same") {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
        keep[k] = true;
      }
    }
  });
  const out: (DiffLine | { kind: "skip"; count: number })[] = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped > 0) {
        out.push({ kind: "skip", count: skipped });
        skipped = 0;
      }
      out.push(l);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) out.push({ kind: "skip", count: skipped });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    if (l.kind === "del") removed++;
  }
  return { added, removed };
}
