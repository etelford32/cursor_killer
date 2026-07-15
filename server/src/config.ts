import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ModelConfig {
  agent: string;
  chat: string;
  inline: string;
}

export interface OmniConfig {
  apiKey?: string;
  models: ModelConfig;
}

export const AVAILABLE_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
];

const DEFAULTS: OmniConfig = {
  models: {
    agent: "claude-opus-4-8",
    chat: "claude-opus-4-8",
    inline: "claude-opus-4-8",
  },
};

const CONFIG_DIR = path.join(os.homedir(), ".omnicode");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function loadConfig(): OmniConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return {
      ...DEFAULTS,
      ...raw,
      models: { ...DEFAULTS.models, ...(raw.models ?? {}) },
    };
  } catch {
    return { ...DEFAULTS, models: { ...DEFAULTS.models } };
  }
}

export function saveConfig(update: Partial<OmniConfig>): OmniConfig {
  const current = loadConfig();
  const next: OmniConfig = {
    ...current,
    ...update,
    models: { ...current.models, ...(update.models ?? {}) },
  };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function getApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || loadConfig().apiKey;
}

export function isMockMode(): boolean {
  if (process.env.MOCK_AI === "1") return true;
  return !getApiKey();
}
