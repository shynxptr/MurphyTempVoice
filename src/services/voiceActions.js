import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  getGuildConfig,
  removeWaitingRoomMapping,
  upsertTempChannel,
} from '../store.js';
import {
  applyOwnerPermissions,
  checkRenameRateLimit,
  deleteTempChannel,
  ensureStayBotsPermissions,
  getEffectiveStayBotIds,
  recordRename,
  syncPrivateChatPermissions,
} from './voiceManager.js';

export async function renameVoiceChannel(voiceChannel, newName) {
  const cleanName = newName.trim().slice(0, 100);
  if (!cleanName) {
    return { ok: false, message: 'Channel name cannot be empty.' };
  }

  const limitCheck = checkRenameRateLimit(voiceChannel.id);
  if (!limitCheck.allowed) {
    const mins = Math.floor(limitCheck.retryAfterSeconds / 60);
    const secs = limitCheck.retryAfterSeconds % 60;
    return {
      ok: false,
      message: `Discord limits channel renames to **2 times per 10 minutes**. Try again in **${mins}m ${secs}s**.`,
    };
  }

  await voiceChannel.setName(cleanName, 'Renamed by TempVoice owner');
  recordRename(voiceChannel.id);
  return { ok: true, message: `Channel renamed to **${cleanName}**.` };
}

export async function setVoiceLimit(voiceChannel, rawLimit) {
  const limit = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(limit) || limit < 0 || limit > 99) {
    return { ok: false, message: 'User limit must be a number between **0** (unlimited) and **99**.' };
  }

  await voiceChannel.setUserLimit(limit, 'User limit updated by TempVoice owner');
  return {
    ok: true,
    message: limit === 0 ? 'User limit removed (**Unlimited**).' : `User limit set to **${limit}**.`,
  };
}

export async function setPrivacyMode(guild, record, voiceChannel, mode) {
  const everyoneId = guild.roles.everyone.id;
  const guildCfg = getGuildConfig(guild.id);

  if (mode === 'lock') {
    await voiceChannel.permissionOverwrites.edit(everyoneId, { Connect: false });
    record.locked = true;
  } else if (mode === 'unlock') {
    await voiceChannel.permissionOverwrites.edit(everyoneId, { Connect: null });
    record.locked = false;
  } else if (mode === 'invisible') {
    await voiceChannel.permissionOverwrites.edit(everyoneId, {
      ViewChannel: false,
      Connect: false,
    });
    record.hidden = true;
    record.locked = true;
  } else if (mode === 'visible') {
    await voiceChannel.permissionOverwrites.edit(everyoneId, { ViewChannel: null });
    record.hidden = false;
  } else {
    return { ok: false, message: 'Unknown privacy mode.' };
  }

  await applyOwnerPermissions(voiceChannel, record.ownerId);
  await ensureStayBotsPermissions(voiceChannel, guildCfg);
  await upsertTempChannel(record);

  const labels = {
    lock: '🔒 Channel is now **Locked** (members cannot connect without trust).',
    unlock: '🔓 Channel is now **Unlocked** (everyone can connect).',
    invisible: '👻 Channel is now **Invisible** (hidden from `@everyone`).',
    visible: '👁️ Channel is now **Visible** (`@everyone` can see the channel).',
  };
  return { ok: true, message: labels[mode] };
}

export async function toggleWaitingRoom(guild, record, voiceChannel) {
  const guildCfg = getGuildConfig(guild.id);

  if (record.waitingRoomId) {
    const waitingCh = await guild.channels.fetch(record.waitingRoomId).catch(() => null);
    if (waitingCh) await waitingCh.delete('Waiting room disabled').catch(() => {});
    await removeWaitingRoomMapping(record.waitingRoomId);
    record.waitingRoomId = null;
    await upsertTempChannel(record);
    return { ok: true, message: '⏳ **Waiting Room disabled** and removed.' };
  }

  // Lock main room so people must wait in the waiting room
  await voiceChannel.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: false });
  record.locked = true;
  await applyOwnerPermissions(voiceChannel, record.ownerId);
  await ensureStayBotsPermissions(voiceChannel, guildCfg);

  const waitingChannel = await guild.channels.create({
    name: `⏳ Waiting - ${voiceChannel.name}`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: voiceChannel.parentId,
    permissionOverwrites: [
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
        ],
      },
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
        deny: [PermissionFlagsBits.Speak],
      },
    ],
  });

  record.waitingRoomId = waitingChannel.id;
  await upsertTempChannel(record);

  return {
    ok: true,
    message:
      `⏳ **Waiting Room enabled** (<#${waitingChannel.id}>) and your main room is now locked.\n` +
      'When someone joins the waiting room, you will get **Accept / Deny** buttons.',
  };
}

export async function togglePrivateChat(guild, record, voiceChannel) {
  if (record.textChatId) {
    const textCh = await guild.channels.fetch(record.textChatId).catch(() => null);
    if (textCh) await textCh.delete('Private chat closed').catch(() => {});
    record.textChatId = null;
    record.chatOpen = false;
    await upsertTempChannel(record);
    return { ok: true, message: '💬 **Private Chat closed** and deleted.' };
  }

  const guildCfg = getGuildConfig(guild.id);
  const stayBotIds = getEffectiveStayBotIds(guildCfg);

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  const initialUsers = new Set([record.ownerId, ...stayBotIds]);
  for (const member of voiceChannel.members.values()) {
    initialUsers.add(member.id);
  }
  for (const trustedId of record.trustedIds ?? []) {
    initialUsers.add(trustedId);
  }

  for (const userId of initialUsers) {
    if (record.blockedIds?.includes(userId)) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    permissionOverwrites.push({
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const slug = voiceChannel.name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'voice-chat';

  const textChannel = await guild.channels.create({
    name: `💬-${slug}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: voiceChannel.parentId,
    permissionOverwrites,
  });

  record.textChatId = textChannel.id;
  record.chatOpen = true;
  await upsertTempChannel(record);
  await syncPrivateChatPermissions(guild, record);

  await textChannel
    .send(`💬 Private text chat created for **${voiceChannel.name}** (<@${record.ownerId}>).`)
    .catch(() => {});

  return { ok: true, message: `💬 **Private Chat created:** <#${textChannel.id}>` };
}

export async function trustUsers(guild, record, voiceChannel, userIds) {
  const trustedSet = new Set(record.trustedIds ?? []);
  const blockedSet = new Set(record.blockedIds ?? []);

  for (const userId of userIds) {
    blockedSet.delete(userId);
    trustedSet.add(userId);
    await voiceChannel.permissionOverwrites
      .edit(userId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
      })
      .catch(() => {});
  }

  record.trustedIds = [...trustedSet];
  record.blockedIds = [...blockedSet];
  await upsertTempChannel(record);
  await syncPrivateChatPermissions(guild, record);

  const mentions = userIds.map((id) => `<@${id}>`).join(', ');
  return { ok: true, message: `✅ Trusted ${mentions} to join and speak in your room.` };
}

export async function untrustUsers(guild, record, voiceChannel, userIds) {
  const trustedSet = new Set(record.trustedIds ?? []);

  for (const userId of userIds) {
    if (userId === record.ownerId) continue;
    trustedSet.delete(userId);
    await voiceChannel.permissionOverwrites.delete(userId).catch(() => {});
  }

  record.trustedIds = [...trustedSet];
  await upsertTempChannel(record);
  await syncPrivateChatPermissions(guild, record);

  const mentions = userIds.map((id) => `<@${id}>`).join(', ');
  return { ok: true, message: `❎ Removed trust permissions for ${mentions}.` };
}

export async function inviteUsers(voiceChannel, inviter, userIds) {
  for (const userId of userIds) {
    await voiceChannel.permissionOverwrites
      .edit(userId, { ViewChannel: true, Connect: true })
      .catch(() => {});
  }

  const invite = await voiceChannel
    .createInvite({ maxAge: 3600, maxUses: 0, unique: false })
    .catch(() => null);

  const dmOk = [];
  const dmFail = [];

  for (const userId of userIds) {
    const member = await voiceChannel.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      dmFail.push(`<@${userId}>`);
      continue;
    }

    try {
      await member.send(
        `📩 **${inviter.displayName}** invited you to join **${voiceChannel.name}** in **${voiceChannel.guild.name}**!\n` +
          (invite ? invite.url : `<#${voiceChannel.id}>`)
      );
      dmOk.push(`<@${userId}>`);
    } catch {
      dmFail.push(`<@${userId}>`);
    }
  }

  const parts = [];
  if (dmOk.length) parts.push(`📩 Sent DM invite to ${dmOk.join(', ')}.`);
  if (dmFail.length) {
    parts.push(`⚠️ Could not DM ${dmFail.join(', ')} (DMs closed), but granted them access to join <#${voiceChannel.id}>.`);
  }
  return { ok: true, message: parts.join('\n') || 'Done.' };
}

export async function kickMembers(record, voiceChannel, targetIds) {
  const kicked = [];
  for (const userId of targetIds) {
    if (userId === record.ownerId) continue;
    const member = voiceChannel.members.get(userId);
    if (member) {
      await member.voice.disconnect('Kicked by TempVoice owner').catch(() => {});
      kicked.push(`<@${userId}>`);
    }
  }

  if (!kicked.length) {
    return { ok: false, message: 'None of the selected users are currently in your voice channel.' };
  }
  return { ok: true, message: `👢 Kicked ${kicked.join(', ')} from your voice channel.` };
}

export async function blockUsers(guild, record, voiceChannel, userIds) {
  const blockedSet = new Set(record.blockedIds ?? []);
  const trustedSet = new Set(record.trustedIds ?? []);
  const actuallyBlocked = [];

  for (const userId of userIds) {
    if (userId === record.ownerId) continue;
    trustedSet.delete(userId);
    blockedSet.add(userId);
    actuallyBlocked.push(`<@${userId}>`);

    await voiceChannel.permissionOverwrites
      .edit(userId, { Connect: false, ViewChannel: null })
      .catch(() => {});

    const inMain = voiceChannel.members.get(userId);
    if (inMain) {
      await inMain.voice.disconnect('Blocked from TempVoice').catch(() => {});
    }

    if (record.waitingRoomId) {
      const waitingCh = await guild.channels.fetch(record.waitingRoomId).catch(() => null);
      const inWait = waitingCh?.members.get(userId);
      if (inWait) {
        await inWait.voice.disconnect('Blocked from TempVoice').catch(() => {});
      }
    }
  }

  record.blockedIds = [...blockedSet];
  record.trustedIds = [...trustedSet];
  await upsertTempChannel(record);
  await syncPrivateChatPermissions(guild, record);

  if (!actuallyBlocked.length) {
    return { ok: false, message: 'You cannot block yourself.' };
  }
  return { ok: true, message: `🚫 Blocked ${actuallyBlocked.join(', ')} from joining this channel.` };
}

export async function unblockUsers(guild, record, voiceChannel, userIds) {
  const blockedSet = new Set(record.blockedIds ?? []);

  for (const userId of userIds) {
    blockedSet.delete(userId);
    await voiceChannel.permissionOverwrites.delete(userId).catch(() => {});
  }

  record.blockedIds = [...blockedSet];
  await upsertTempChannel(record);
  await syncPrivateChatPermissions(guild, record);

  const mentions = userIds.map((id) => `<@${id}>`).join(', ');
  return { ok: true, message: `⭕ Unblocked ${mentions}.` };
}

export async function claimChannel(guild, record, voiceChannel, member) {
  if (member.user.bot) {
    return { ok: false, message: 'Bots cannot claim ownership.' };
  }
  if (record.ownerId === member.id) {
    return { ok: false, message: 'You already own this voice channel.' };
  }
  if (voiceChannel.members.has(record.ownerId)) {
    return {
      ok: false,
      message: `The current owner (<@${record.ownerId}>) is still in this voice channel.`,
    };
  }

  const prevOwnerId = record.ownerId;
  if (!record.trustedIds?.includes(prevOwnerId)) {
    await voiceChannel.permissionOverwrites.delete(prevOwnerId).catch(() => {});
  }

  record.ownerId = member.id;
  await applyOwnerPermissions(voiceChannel, member.id);
  await upsertTempChannel(record);
  await syncPrivateChatPermissions(guild, record);

  return { ok: true, message: `👑 You are now the owner of **${voiceChannel.name}**!` };
}

export async function transferOwnership(guild, record, voiceChannel, newOwnerId) {
  if (newOwnerId === record.ownerId) {
    return { ok: false, message: 'You already own this voice channel.' };
  }

  const target = voiceChannel.members.get(newOwnerId);
  if (!target || target.user.bot) {
    return { ok: false, message: 'You can only transfer ownership to a human member currently in the voice channel.' };
  }

  const prevOwnerId = record.ownerId;
  if (!record.trustedIds?.includes(prevOwnerId)) {
    await voiceChannel.permissionOverwrites.delete(prevOwnerId).catch(() => {});
  }

  record.ownerId = newOwnerId;
  await applyOwnerPermissions(voiceChannel, newOwnerId);
  await upsertTempChannel(record);
  await syncPrivateChatPermissions(guild, record);

  return { ok: true, message: `🔁 Ownership transferred to <@${newOwnerId}>.` };
}

export async function deleteOwnerChannel(guild, record) {
  await deleteTempChannel(guild, record.channelId, 'Deleted by TempVoice owner');
  return { ok: true, message: '🗑️ Your voice channel has been deleted.' };
}

