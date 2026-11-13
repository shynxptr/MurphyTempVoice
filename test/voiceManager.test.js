import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ASSETS_DIR, config } from '../src/config.js';
import { BUTTON_DEFINITIONS } from '../src/emojis.js';
import {
  checkRenameRateLimit,
  isChannelOccupied,
  recordRename,
} from '../src/services/voiceManager.js';

function makeChannel(membersList) {
  const map = new Map();
  for (const m of membersList) {
    map.set(m.id, { id: m.id, user: { bot: Boolean(m.bot) } });
  }
  return {
    members: {
      size: map.size,
      some: (fn) => [...map.values()].some(fn),
    },
  };
}

test('all 15 button icon assets and interface banner exist', async () => {
  assert.equal(BUTTON_DEFINITIONS.length, 15);
  for (const def of BUTTON_DEFINITIONS) {
    const stat = await fs.stat(path.join(ASSETS_DIR, def.file));
    assert.ok(stat.isFile(), `Missing icon file ${def.file}`);
    assert.ok(stat.size <= 256 * 1024, `${def.file} exceeds 256KB Discord emoji limit`);
  }
  const bannerStat = await fs.stat(path.join(ASSETS_DIR, 'interface-banner.png'));
  assert.ok(bannerStat.isFile());
});

test('isChannelOccupied keeps channel alive for human or whitelisted AFK bot', () => {
  const guildCfg = { stayBotIds: ['111111111111111111'], allowAnyBotStay: false };

  // Empty channel
  assert.equal(isChannelOccupied(makeChannel([]), guildCfg), false);

  // Human inside
  assert.equal(isChannelOccupied(makeChannel([{ id: '222', bot: false }]), guildCfg), true);

  // Whitelisted AFK bot alone inside -> stays alive
  assert.equal(
    isChannelOccupied(makeChannel([{ id: '111111111111111111', bot: true }]), guildCfg),
    true
  );

  // Random non-whitelisted bot alone inside -> allowed to close
  assert.equal(
    isChannelOccupied(makeChannel([{ id: '999999999999999999', bot: true }]), guildCfg),
    false
  );

  // With allowAnyBotStay: true -> any bot keeps it alive
  assert.equal(
    isChannelOccupied(makeChannel([{ id: '999999999999999999', bot: true }]), {
      stayBotIds: [],
      allowAnyBotStay: true,
    }),
    true
  );
});

test('checkRenameRateLimit blocks 3rd rename within 10 minutes', () => {
  const chId = 'test-rename-ch-1';
  assert.equal(checkRenameRateLimit(chId).allowed, true);
  recordRename(chId);
  assert.equal(checkRenameRateLimit(chId).allowed, true);
  recordRename(chId);
  const third = checkRenameRateLimit(chId);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSeconds > 0);
  assert.ok(config.emptyGraceSeconds >= 0);
});

