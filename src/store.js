import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const STATE_FILE = path.join(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  guilds: {},
  channels: {},
  waitingRooms: {},
};

let state = structuredClone(DEFAULT_STATE);
let writeQueue = Promise.resolve();

export async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    state = {
      guilds: parsed.guilds && typeof parsed.guilds === 'object' ? parsed.guilds : {},
      channels: parsed.channels && typeof parsed.channels === 'object' ? parsed.channels : {},
      waitingRooms: parsed.waitingRooms && typeof parsed.waitingRooms === 'object' ? parsed.waitingRooms : {},
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[Store] Failed to load state.json, starting fresh:', err.message);
    }
    state = structuredClone(DEFAULT_STATE);
    await saveStore();
  }
  return state;
}

export function saveStore() {
  const snapshot = JSON.stringify(state, null, 2);
  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${STATE_FILE}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, STATE_FILE);
    })
    .catch((err) => {
      console.error('[Store] Failed to save state.json:', err);
    });
  return writeQueue;
}

export function getGuildConfig(guildId) {
  return state.guilds[guildId] ?? null;
}

export async function setGuildConfig(guildId, patch) {
  const current = state.guilds[guildId] ?? {
    categoryId: null,
    interfaceChannelId: null,
    interfaceMessageId: null,
    joinToCreateChannelId: null,
    defaultNameTemplate: "{username}'s VC",
    stayBotIds: [],
    allowAnyBotStay: null,
  };
  state.guilds[guildId] = { ...current, ...patch };
  await saveStore();
  return state.guilds[guildId];
}

export function getTempChannel(channelId) {
  return state.channels[channelId] ?? null;
}

export function getAllTempChannels() {
  return Object.values(state.channels);
}

export function getTempChannelByWaitingRoom(waitingRoomId) {
  const mainId = state.waitingRooms[waitingRoomId];
  if (!mainId) return null;
  return state.channels[mainId] ?? null;
}

export async function upsertTempChannel(record) {
  state.channels[record.channelId] = record;
  if (record.waitingRoomId) {
    state.waitingRooms[record.waitingRoomId] = record.channelId;
  }
  await saveStore();
  return record;
}

export async function removeWaitingRoomMapping(waitingRoomId) {
  if (!waitingRoomId) return;
  delete state.waitingRooms[waitingRoomId];
  await saveStore();
}

export async function deleteTempChannelRecord(channelId) {
  const existing = state.channels[channelId];
  if (!existing) return;
  if (existing.waitingRoomId) {
    delete state.waitingRooms[existing.waitingRoomId];
  }
  delete state.channels[channelId];
  await saveStore();
}

