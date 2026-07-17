// Omni Code desktop shell.
//
// The Electron main process spawns the Omni server (the same Node server used
// in web mode, bundled to plain JS) as a child process running on Electron's
// own Node runtime (ELECTRON_RUN_AS_NODE), then opens a window pointing at it.
// The renderer is the ordinary Omni web client — no nodeIntegration, no preload.

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
let serverPort = 0;
let currentWorkspace = null;

const SERVER_ENTRY = path.join(__dirname, "server-dist", "index.cjs");
const SETTINGS_PATH = () => path.join(app.getPath("userData"), "desktop.json");

function loadDesktopSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH(), "utf8"));
  } catch {
    return {};
  }
}

function saveDesktopSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2));
  } catch {
    /* settings are best-effort */
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

async function startServer(workspaceDir) {
  stopServer();
  serverPort = await freePort();
  currentWorkspace = workspaceDir;

  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(serverPort),
      OMNI_DIR: workspaceDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("Omni Code", `The Omni server exited unexpectedly (code ${code}).`);
    }
  });

  // Wait for the server to answer before loading the window.
  const url = `http://127.0.0.1:${serverPort}/api/config`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("Omni server did not start within 15s");
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function pickWorkspace(win) {
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: "Open Folder in Omni Code",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

async function openWorkspace(workspaceDir) {
  await startServer(workspaceDir);
  saveDesktopSettings({ lastWorkspace: workspaceDir });
  if (mainWindow) {
    await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
    mainWindow.setTitle(`${path.basename(workspaceDir)} — Omni Code`);
  }
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: async () => {
            const dir = await pickWorkspace(mainWindow);
            if (dir) await openWorkspace(dir);
          },
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Omni Code on GitHub",
          click: () => shell.openExternal("https://github.com/etelford32/Omni"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0c1013",
    title: "Omni Code",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // External links open in the system browser, not inside the editor window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Workspace: CLI arg > last-used > folder picker > cwd.
  const argDir = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => {
    try {
      return !a.startsWith("-") && fs.statSync(a).isDirectory();
    } catch {
      return false;
    }
  });
  const remembered = loadDesktopSettings().lastWorkspace;
  let dir = argDir ?? (remembered && fs.existsSync(remembered) ? remembered : null);
  if (!dir && !process.env.OMNI_SKIP_PICKER) {
    dir = await pickWorkspace(null);
  }
  await openWorkspace(dir ?? process.cwd());
}

app.whenReady().then(async () => {
  buildMenu();
  try {
    await createWindow();
  } catch (err) {
    dialog.showErrorBox("Omni Code failed to start", String(err));
    app.quit();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
