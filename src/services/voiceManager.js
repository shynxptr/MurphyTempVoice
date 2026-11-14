import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import {
  deleteTempChannelRecord,
  getAllTempChannels,
  getGuildConfig,
  getTempChannel,
  getTempChannelByWaitingRoom,
  removeWaitingRoomMapping,
  upsertTempChannel,
} from '../store.js';

const pendingDeletions = new Map();
const createCooldowns = new Map();
const inFlightJoins = new Set();
const renameTimestamps = new Map();

export function getEffectiveStayBotIds(guildCfg) {
  const merged = new Set(config.stayBotIds);
  if (guildCfg?.stayBotIds) {
    for (const id of guildCfg.stayBotIds) merged.add(id);
  }
  return merged;
}

export function getEffectiveAllowAnyBot(guildCfg) {
  if (typeof guildCfg?.allowAnyBotStay === 'boolean') {
    return guildCfg.allowAnyBotStay;
  }
  return config.allowAnyBotStay;
}

/**
 * Checks whether a TempVoice channel should stay alive.
 * Returns true if at least one human member OR one authorized AFK/Music bot is connected.
 */
export function isChannelOccupied(channel, guildCfg) {
  if (!channel || !channel.members) return false;
  if (channel.members.size === 0) return false;

  const allowAnyBot = getEffectiveAllowAnyBot(guildCfg);
  if (allowAnyBot) return true;

  const stayBotIds = getEffectiveStayBotIds(guildCfg);
  return channel.members.some(
    (member) => !member.user.bot || stayBotIds.has(member.id)
  );
}

/**
 * Checks Discord's 2-renames-per-10-minutes channel rename limit locally
 * so interaction handlers never hang waiting on discord.js's REST queue.
 */
export function checkRenameRateLimit(channelId) {
  const windowMs = 10 * 60 * 1000;
  const now = Date.now();
  const recent = (renameTimestamps.get(channelId) ?? []).filter((ts) => now - ts < windowMs);
  renameTimestamps.set(channelId, recent);

  if (recent.length >= 2) {
    const waitMs = windowMs - (now - recent[0]);
    return { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordRename(channelId) {
  const windowMs = 10 * 60 * 1000;
  const now = Date.now();
  const recent = (renameTimestamps.get(channelId) ?? []).filter((ts) => now - ts < windowMs);
  recent.push(now);
  renameTimestamps.set(channelId, recent);
}

export function cancelDeletion(channelId) {
  const timer = pendingDeletions.get(channelId);
  if (timer) {
    clearTimeout(timer);
    pendingDeletions.delete(channelId);
  }
}

/**
 * Ensures all whitelisted AFK/Music bots keep ViewChannel + Connect + Speak
 * even when the room owner locks or hides the channel.
 */
export async function ensureStayBotsPermissions(channel, guildCfg) {
  const stayBotIds = getEffectiveStayBotIds(guildCfg);
  for (const botId of stayBotIds) {
    const member = await channel.guild.members.fetch(botId).catch(() => null);
    if (!member) continue;
    await channel.permissionOverwrites
      .edit(botId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
      })
      .catch(() => {});
  }
}

export async function applyOwnerPermissions(channel, ownerId) {
  await channel.permissionOverwrites
    .edit(ownerId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      MoveMembers: true,
      MuteMembers: true,
      DeafenMembers: true,
    })
    .catch(() => {});
}

export async function syncPrivateChatPermissions(guild, record) {
  if (!record?.textChatId) return;
  const textChannel = await guild.channels.fetch(record.textChatId).catch(() => null);
  const voiceChannel = await guild.channels.fetch(record.channelId).catch(() => null);
  if (!textChannel || !voiceChannel) return;

  const guildCfg = getGuildConfig(guild.id);
  const stayBotIds = getEffectiveStayBotIds(guildCfg);

  const allowedIds = new Set([record.ownerId, guild.members.me?.id, ...stayBotIds].filter(Boolean));
  for (const member of voiceChannel.members.values()) {
    allowedIds.add(member.id);
  }
  for (const trustedId of record.trustedIds ?? []) {
    allowedIds.add(trustedId);
  }

  for (const [overwriteId, overwrite] of textChannel.permissionOverwrites.cache) {
    if (overwriteId === guild.roles.everyone.id) continue;
    if (overwrite.type === OverwriteType.Member && !allowedIds.has(overwriteId)) {
      await textChannel.permissionOverwrites.delete(overwriteId).catch(() => {});
    }
  }

  for (const userId of allowedIds) {
    if (record.blockedIds?.includes(userId)) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    await textChannel.permissionOverwrites
      .edit(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      })
      .catch(() => {});
  }
}

export async function deleteTempChannel(guild, channelId, reason = 'TempVoice closed') {
  cancelDeletion(channelId);
  const record = getTempChannel(channelId);

  if (record?.waitingRoomId) {
    const waitingCh = await guild.channels.fetch(record.waitingRoomId).catch(() => null);
    if (waitingCh) await waitingCh.delete(reason).catch(() => {});
  }

  if (record?.textChatId) {
    const textCh = await guild.channels.fetch(record.textChatId).catch(() => null);
    if (textCh) await textCh.delete(reason).catch(() => {});
  }

  const mainCh = await guild.channels.fetch(channelId).catch(() => null);
  if (mainCh) await mainCh.delete(reason).catch(() => {});

  renameTimestamps.delete(channelId);
  await deleteTempChannelRecord(channelId);
}

export function scheduleEmptyCheck(guild, channelId) {
  const record = getTempChannel(channelId);
  if (!record) return;

  const guildCfg = getGuildConfig(guild.id);
  const channel = guild.channels.cache.get(channelId);

  if (channel && isChannelOccupied(channel, guildCfg)) {
    cancelDeletion(channelId);
    return;
  }

  if (pendingDeletions.has(channelId)) return;

  const delayMs = config.emptyGraceSeconds * 1000;
  const timer = setTimeout(async () => {
    pendingDeletions.delete(channelId);
    const freshChannel = await guild.channels.fetch(channelId).catch(() => null);
    if (!freshChannel) {
      await deleteTempChannel(guild, channelId, 'Channel already deleted externally');
      return;
    }

    const latestCfg = getGuildConfig(guild.id);
    if (isChannelOccupied(freshChannel, latestCfg)) {
      return;
    }

    await deleteTempChannel(guild, channelId, 'TempVoice empty (no humans or authorized AFK bot)');
  }, delayMs);

  pendingDeletions.set(channelId, timer);
}

function formatChannelName(template, member) {
  const base = template || "{username}'s VC";
  const name = base
    .replaceAll('{username}', member.user.username)
    .replaceAll('{displayname}', member.displayName)
    .replaceAll('{tag}', member.user.tag);
  return name.slice(0, 100);
}

async function handleJoinToCreate(newState, guildCfg) {
  const guild = newState.guild;
  const member =
    newState.member ??
    (newState.id ? await guild.members.fetch(newState.id).catch(() => null) : null);
  if (!member || member.user.bot) return;

  const inFlightKey = `${guild.id}:${member.id}`;
  if (inFlightJoins.has(inFlightKey)) return;

  const cooldownMs = config.createCooldownSeconds * 1000;
  const lastCreate = createCooldowns.get(member.id) ?? 0;
  if (Date.now() - lastCreate < cooldownMs) {
    console.log(`[VoiceManager] Cooldown active for ${member.user.tag} in ${guild.name}`);
    return;
  }

  inFlightJoins.add(inFlightKey);
  createCooldowns.set(member.id, Date.now());

  try {
    const triggerChannel = newState.channel;
    const triggerId = newState.channelId;
    const parentId = guildCfg.categoryId || triggerChannel?.parentId || null;

    const permissionOverwrites = [
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
        ],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.MuteMembers,
          PermissionFlagsBits.DeafenMembers,
        ],
      },
    ];

    const stayBotIds = [...getEffectiveStayBotIds(guildCfg)];
    const botMembers = await Promise.all(
      stayBotIds.map(
        (botId) => guild.members.cache.get(botId) ?? guild.members.fetch(botId).catch(() => null)
      )
    );
    for (const botMember of botMembers) {
      if (botMember) {
        permissionOverwrites.push({
          id: botMember.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
          ],
        });
      }
    }

    const createdChannel = await guild.channels.create({
      name: formatChannelName(guildCfg.defaultNameTemplate, member),
      type: ChannelType.GuildVoice,
      parent: parentId,
      permissionOverwrites,
    });

    const record = {
      channelId: createdChannel.id,
      guildId: guild.id,
      ownerId: member.id,
      createdAt: Date.now(),
      waitingRoomId: null,
      textChatId: null,
      locked: false,
      hidden: false,
      chatOpen: false,
      trustedIds: [],
      blockedIds: [],
    };

    await upsertTempChannel(record);

    try {
      const currentVoiceId = member.voice?.channelId ?? triggerId;
      if (currentVoiceId === triggerId) {
        await member.voice.setChannel(createdChannel, 'Moved to Murphy Temp Voice');
        console.log(`[VoiceManager] Created "${createdChannel.name}" and moved ${member.user.tag}`);
      } else if (createdChannel.members.size === 0) {
        await deleteTempChannel(guild, createdChannel.id, 'Member left Join-to-Create before move');
      }
    } catch (err) {
      console.error(
        `[VoiceManager] Failed to move ${member.user.tag} from "${triggerChannel?.name ?? triggerId}" to "${createdChannel.name}" (check MoveMembers & Connect permissions):`,
        err.message
      );
      if (createdChannel.members.size === 0) {
        await deleteTempChannel(guild, createdChannel.id, 'Failed to move member to new TempVoice');
      } else {
        scheduleEmptyCheck(guild, createdChannel.id);
      }
    }
  } finally {
    inFlightJoins.delete(inFlightKey);
  }
}

async function handleWaitingRoomJoin(newState, mainRecord) {
  const member = newState.member;
  const guild = newState.guild;
  if (!member || member.user.bot) return;

  if (mainRecord.blockedIds?.includes(member.id)) {
    await member.voice.disconnect('Blocked from TempVoice').catch(() => {});
    return;
  }

  const mainChannel = await guild.channels.fetch(mainRecord.channelId).catch(() => null);
  if (!mainChannel) {
    await removeWaitingRoomMapping(newState.channelId);
    return;
  }

  const targetTextChannel =
    (mainRecord.textChatId && (await guild.channels.fetch(mainRecord.textChatId).catch(() => null))) ||
    mainChannel;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mtv_wait:accept:${mainRecord.channelId}:${member.id}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`mtv_wait:deny:${mainRecord.channelId}:${member.id}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
  );

  await targetTextChannel
    .send({
      content: `⏳ <@${member.id}> is waiting in the waiting room to join **${mainChannel.name}**. <@${mainRecord.ownerId}>`,
      components: [row],
    })
    .catch(() => {});
}

export async function handleVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const guildCfg = getGuildConfig(guild.id);
  const oldId = oldState.channelId;
  const newId = newState.channelId;

  // Channel unchanged (mute/deafen/stream toggle)
  if (oldId === newId) return;

  // 1. Joined a tracked TempVoice channel (human OR bot) -> cancel pending deletion & sync chat
  if (newId) {
    const joinedRecord = getTempChannel(newId);
    if (joinedRecord) {
      cancelDeletion(newId);
      await syncPrivateChatPermissions(guild, joinedRecord);
    }
  }

  // 2. Left a tracked TempVoice channel (human OR bot) -> schedule empty check & sync chat
  if (oldId) {
    const leftRecord = getTempChannel(oldId);
    if (leftRecord) {
      await syncPrivateChatPermissions(guild, leftRecord);
      scheduleEmptyCheck(guild, oldId);
    }
  }

  // 3. Joined Join-to-Create trigger
  if (newId && guildCfg?.joinToCreateChannelId === newId) {
    await handleJoinToCreate(newState, guildCfg);
    return;
  }

  // 4. Joined a Waiting Room
  if (newId) {
    const waitingMainRecord = getTempChannelByWaitingRoom(newId);
    if (waitingMainRecord) {
      await handleWaitingRoomJoin(newState, waitingMainRecord);
    }
  }
}

export async function reconcileOnStartup(client) {
  const records = getAllTempChannels();
  for (const record of records) {
    const guild = client.guilds.cache.get(record.guildId);
    if (!guild) {
      await deleteTempChannelRecord(record.channelId);
      continue;
    }

    const channel = await guild.channels.fetch(record.channelId).catch(() => null);
    if (!channel) {
      await deleteTempChannel(guild, record.channelId, 'Startup cleanup for missing channel');
      continue;
    }

    const guildCfg = getGuildConfig(guild.id);
    if (!isChannelOccupied(channel, guildCfg)) {
      scheduleEmptyCheck(guild, record.channelId);
    }
  }
}
