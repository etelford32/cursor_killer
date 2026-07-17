// Bundle the Omni server to plain CommonJS for the desktop app, and copy the
// built client alongside it. Output layout (what electron-builder packages):
//   desktop/main.cjs
//   desktop/server-dist/index.cjs
//   desktop/client-dist/**
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "server/src/index.ts")],
  outfile: path.join(root, "desktop/server-dist/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // node-pty is a native optional dependency — leave it external so the
  // terminal's pipe-mode fallback kicks in when it isn't present.
  external: ["node-pty"],
  banner: {
    js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
  define: { "import.meta.url": "__importMetaUrl" },
  logLevel: "info",
});

const clientSrc = path.join(root, "client/dist");
const clientDest = path.join(root, "desktop/client-dist");
if (!fs.existsSync(clientSrc)) {
  console.error("client/dist not found — run `npm run build --workspace=client` first");
  process.exit(1);
}
fs.rmSync(clientDest, { recursive: true, force: true });
fs.cpSync(clientSrc, clientDest, { recursive: true });
console.log(`copied client → ${path.relative(root, clientDest)}`);
