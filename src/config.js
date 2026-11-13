import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
export const DATA_DIR = path.join(ROOT_DIR, 'data');

function parseIdList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{15,22}$/.test(s));
}

function parsePositiveInt(raw, fallback) {
  const num = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

export const config = {
  token: process.env.DISCORD_TOKEN?.trim() || '',
  stayBotIds: parseIdList(process.env.STAY_BOT_IDS),
  allowAnyBotStay: String(process.env.ALLOW_ANY_BOT_STAY ?? 'false').toLowerCase() === 'true',
  emptyGraceSeconds: parsePositiveInt(process.env.EMPTY_GRACE_SECONDS, 15),
  createCooldownSeconds: parsePositiveInt(process.env.CREATE_COOLDOWN_SECONDS, 3),
  autoSyncAppEmojis: String(process.env.AUTO_SYNC_APP_EMOJIS ?? 'true').toLowerCase() !== 'false',
};

export function assertConfig() {
  if (!config.token) {
    throw new Error('DISCORD_TOKEN belum diisi di file .env. Salin .env.example menjadi .env lalu isi token bot.');
  }
}

