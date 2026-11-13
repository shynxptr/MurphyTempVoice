import fs from 'node:fs/promises';
import path from 'node:path';
import { ASSETS_DIR } from './config.js';

/**
 * 15 TempVoice interface buttons arranged in 3 rows x 5 columns,
 * matching assets/interface-banner.png exactly.
 */
export const BUTTON_DEFINITIONS = [
  // Row 1
  { key: 'name', file: 'name.webp', emojiName: 'mtv_name', fallback: '✏️', label: 'Name' },
  { key: 'limit', file: 'limit.webp', emojiName: 'mtv_limit', fallback: '👥', label: 'Limit' },
  { key: 'privacy', file: 'privacy.webp', emojiName: 'mtv_privacy', fallback: '🔒', label: 'Privacy' },
  { key: 'waiting_room', file: 'waiting_room.webp', emojiName: 'mtv_waiting_room', fallback: '⏳', label: 'Waiting Room' },
  { key: 'chat', file: 'chat.webp', emojiName: 'mtv_chat', fallback: '💬', label: 'Chat' },

  // Row 2
  { key: 'trust', file: 'trust.webp', emojiName: 'mtv_trust', fallback: '✅', label: 'Trust' },
  { key: 'untrust', file: 'untrust.webp', emojiName: 'mtv_untrust', fallback: '❎', label: 'Untrust' },
  { key: 'invite', file: 'invite.webp', emojiName: 'mtv_invite', fallback: '📩', label: 'Invite' },
  { key: 'kick', file: 'kick.webp', emojiName: 'mtv_kick', fallback: '👢', label: 'Kick' },
  { key: 'region', file: 'region.webp', emojiName: 'mtv_region', fallback: '🌐', label: 'Region' },

  // Row 3
  { key: 'block', file: 'block.webp', emojiName: 'mtv_block', fallback: '🚫', label: 'Block' },
  { key: 'unblock', file: 'unblock.webp', emojiName: 'mtv_unblock', fallback: '⭕', label: 'Unblock' },
  { key: 'claim', file: 'claim.webp', emojiName: 'mtv_claim', fallback: '👑', label: 'Claim' },
  { key: 'transfer', file: 'transfer.webp', emojiName: 'mtv_transfer', fallback: '🔁', label: 'Transfer' },
  { key: 'delete', file: 'delete.webp', emojiName: 'mtv_delete', fallback: '🗑️', label: 'Delete' },
];

const appEmojiMap = new Map();

/**
 * Fetches existing Discord Application Emojis and uploads any missing .webp icons.
 * Passing an explicit `data:image/webp;base64,...` data URI avoids discord.js
 * DataResolver defaulting local files to `image/jpg`.
 */
export async function syncApplicationEmojis(client, { uploadMissing = true } = {}) {
  if (!client.application) return appEmojiMap;

  try {
    const existing = await client.application.emojis.fetch();
    const byName = new Map(existing.map((e) => [e.name, e]));

    for (const def of BUTTON_DEFINITIONS) {
      let emoji = byName.get(def.emojiName);
      if (!emoji && uploadMissing) {
        const filePath = path.join(ASSETS_DIR, def.file);
        const buf = await fs.readFile(filePath);
        const dataUri = `data:image/webp;base64,${buf.toString('base64')}`;
        emoji = await client.application.emojis.create({
          attachment: dataUri,
          name: def.emojiName,
        });
        console.log(`[Emojis] Uploaded Application Emoji :${emoji.name}: (${emoji.id})`);
      }

      if (emoji) {
        appEmojiMap.set(def.key, emoji.id);
      }
    }
  } catch (err) {
    console.warn('[Emojis] Failed to sync Application Emojis (will use guild/unicode fallback):', err.message);
  }

  return appEmojiMap;
}

export function resolveButtonEmoji(key, guild = null) {
  const appId = appEmojiMap.get(key);
  if (appId) return { id: appId };

  const def = BUTTON_DEFINITIONS.find((d) => d.key === key);
  if (!def) return '❓';

  if (guild) {
    const guildEmoji = guild.emojis.cache.find((e) => e.name === def.emojiName);
    if (guildEmoji) return { id: guildEmoji.id };
  }

  return def.fallback;
}

