import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { getTempChannel } from '../store.js';
import {
  blockUsers,
  claimChannel,
  deleteOwnerChannel,
  inviteUsers,
  kickMembers,
  renameVoiceChannel,
  setPrivacyMode,
  setVoiceLimit,
  togglePrivateChat,
  toggleWaitingRoom,
  transferOwnership,
  trustUsers,
  unblockUsers,
  untrustUsers,
} from '../services/voiceActions.js';

const RTC_REGIONS = [
  { label: 'Automatic (Default)', value: 'auto', emoji: '🌐' },
  { label: 'Singapore', value: 'singapore', emoji: '🇸🇬' },
  { label: 'Hong Kong', value: 'hongkong', emoji: '🇭🇰' },
  { label: 'Japan', value: 'japan', emoji: '🇯🇵' },
  { label: 'Sydney', value: 'sydney', emoji: '🇦🇺' },
  { label: 'India', value: 'india', emoji: '🇮🇳' },
  { label: 'US West', value: 'us-west', emoji: '🇺🇸' },
  { label: 'US East', value: 'us-east', emoji: '🇺🇸' },
  { label: 'US Central', value: 'us-central', emoji: '🇺🇸' },
  { label: 'US South', value: 'us-south', emoji: '🇺🇸' },
  { label: 'Rotterdam (EU)', value: 'rotterdam', emoji: '🇳🇱' },
  { label: 'Brazil', value: 'brazil', emoji: '🇧🇷' },
  { label: 'South Africa', value: 'southafrica', emoji: '🇿🇦' },
];

async function replyEphemeral(interaction, contentOrPayload) {
  const payload =
    typeof contentOrPayload === 'string'
      ? { content: contentOrPayload, flags: MessageFlags.Ephemeral }
      : { ...contentOrPayload, flags: MessageFlags.Ephemeral };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

async function resolveOwnedContext(interaction, { requireOwner = true, targetChannelId = null } = {}) {
  const member = interaction.member;
  const voiceChannel = targetChannelId
    ? await interaction.guild.channels.fetch(targetChannelId).catch(() => null)
    : member?.voice?.channel;

  if (!voiceChannel) {
    await replyEphemeral(interaction, 'You must be connected to a voice channel first.');
    return null;
  }

  const record = getTempChannel(voiceChannel.id);
  if (!record) {
    await replyEphemeral(interaction, 'This voice channel is not a **Murphy Temp Voice** channel.');
    return null;
  }

  if (requireOwner && record.ownerId !== interaction.user.id) {
    await replyEphemeral(
      interaction,
      `Only the room owner (<@${record.ownerId}>) can use this control.`
    );
    return null;
  }

  return { voiceChannel, record, member };
}

function buildUserSelectPrompt(customId, placeholder, maxValues = 10) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(maxValues)
  );
}

async function handleMainButton(interaction, key) {
  if (key === 'claim') {
    const ctx = await resolveOwnedContext(interaction, { requireOwner: false });
    if (!ctx) return;
    const res = await claimChannel(interaction.guild, ctx.record, ctx.voiceChannel, ctx.member);
    return replyEphemeral(interaction, res.message);
  }

  const ctx = await resolveOwnedContext(interaction, { requireOwner: true });
  if (!ctx) return;

  const { voiceChannel, record } = ctx;

  switch (key) {
    case 'name': {
      const modal = new ModalBuilder()
        .setCustomId(`mtv_modal:name:${voiceChannel.id}`)
        .setTitle('Change Channel Name');

      const input = new TextInputBuilder()
        .setCustomId('channel_name')
        .setLabel('New Voice Channel Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setValue(voiceChannel.name.slice(0, 100));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    case 'limit': {
      const modal = new ModalBuilder()
        .setCustomId(`mtv_modal:limit:${voiceChannel.id}`)
        .setTitle('Change User Limit');

      const input = new TextInputBuilder()
        .setCustomId('user_limit')
        .setLabel('User Limit (0 = Unlimited, max 99)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2)
        .setValue(String(voiceChannel.userLimit ?? 0));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    case 'privacy': {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`mtv_select:privacy:${voiceChannel.id}`)
        .setPlaceholder('Select a privacy mode...')
        .addOptions(
          { label: 'Lock', description: 'Prevent members from connecting', value: 'lock', emoji: '🔒' },
          { label: 'Unlock', description: 'Allow everyone to connect', value: 'unlock', emoji: '🔓' },
          { label: 'Invisible', description: 'Hide channel from @everyone', value: 'invisible', emoji: '👻' },
          { label: 'Visible', description: 'Make channel visible to @everyone', value: 'visible', emoji: '👁️' }
        );

      return replyEphemeral(interaction, {
        content: 'Choose a **Privacy** setting for your channel:',
        components: [new ActionRowBuilder().addComponents(menu)],
      });
    }

    case 'waiting_room': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await toggleWaitingRoom(interaction.guild, record, voiceChannel);
      return replyEphemeral(interaction, res.message);
    }

    case 'chat': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await togglePrivateChat(interaction.guild, record, voiceChannel);
      return replyEphemeral(interaction, res.message);
    }

    case 'trust':
      return replyEphemeral(interaction, {
        content: 'Select user(s) to **Trust** in your channel:',
        components: [buildUserSelectPrompt(`mtv_select:trust:${voiceChannel.id}`, 'Select users to trust...')],
      });

    case 'untrust':
      return replyEphemeral(interaction, {
        content: 'Select user(s) to **Untrust**:',
        components: [buildUserSelectPrompt(`mtv_select:untrust:${voiceChannel.id}`, 'Select users to untrust...')],
      });

    case 'invite':
      return replyEphemeral(interaction, {
        content: 'Select user(s) to **Invite** via DM:',
        components: [buildUserSelectPrompt(`mtv_select:invite:${voiceChannel.id}`, 'Select users to invite...', 5)],
      });

    case 'kick': {
      const candidates = [...voiceChannel.members.values()]
        .filter((m) => m.id !== record.ownerId)
        .slice(0, 25);

      if (!candidates.length) {
        return replyEphemeral(interaction, 'There is no one else in your voice channel to kick.');
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`mtv_select:kick:${voiceChannel.id}`)
        .setPlaceholder('Select member(s) to kick...')
        .setMinValues(1)
        .setMaxValues(candidates.length)
        .addOptions(
          candidates.map((m) => ({
            label: m.displayName.slice(0, 100),
            description: m.user.bot ? 'Bot' : m.user.username,
            value: m.id,
          }))
        );

      return replyEphemeral(interaction, {
        content: 'Select member(s) to **Kick** from your voice channel:',
        components: [new ActionRowBuilder().addComponents(menu)],
      });
    }

    case 'region': {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`mtv_select:region:${voiceChannel.id}`)
        .setPlaceholder('Select a voice region...')
        .addOptions(
          RTC_REGIONS.map((r) => ({
            label: r.label,
            value: r.value,
            emoji: r.emoji,
          }))
        );

      return replyEphemeral(interaction, {
        content: 'Choose a **Voice Region** for your channel:',
        components: [new ActionRowBuilder().addComponents(menu)],
      });
    }

    case 'block':
      return replyEphemeral(interaction, {
        content: 'Select user(s) to **Block** from joining:',
        components: [buildUserSelectPrompt(`mtv_select:block:${voiceChannel.id}`, 'Select users to block...')],
      });

    case 'unblock':
      return replyEphemeral(interaction, {
        content: 'Select user(s) to **Unblock**:',
        components: [buildUserSelectPrompt(`mtv_select:unblock:${voiceChannel.id}`, 'Select users to unblock...')],
      });

    case 'transfer': {
      const candidates = [...voiceChannel.members.values()]
        .filter((m) => !m.user.bot && m.id !== record.ownerId)
        .slice(0, 25);

      if (!candidates.length) {
        return replyEphemeral(
          interaction,
          'There are no other human members in your voice channel to transfer ownership to.'
        );
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`mtv_select:transfer:${voiceChannel.id}`)
        .setPlaceholder('Select the new owner...')
        .addOptions(
          candidates.map((m) => ({
            label: m.displayName.slice(0, 100),
            description: m.user.username,
            value: m.id,
          }))
        );

      return replyEphemeral(interaction, {
        content: 'Select a member to **Transfer Ownership** to:',
        components: [new ActionRowBuilder().addComponents(menu)],
      });
    }

    case 'delete': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await deleteOwnerChannel(interaction.guild, record);
      return replyEphemeral(interaction, res.message);
    }

    default:
      return replyEphemeral(interaction, 'Unknown button action.');
  }
}

async function handleWaitingButton(interaction, parts) {
  const [, decision, mainChannelId, requesterId] = parts;
  const ctx = await resolveOwnedContext(interaction, {
    requireOwner: true,
    targetChannelId: mainChannelId,
  });
  if (!ctx) return;

  const { voiceChannel, record } = ctx;
  const requester = await interaction.guild.members.fetch(requesterId).catch(() => null);

  if (decision === 'accept') {
    await voiceChannel.permissionOverwrites
      .edit(requesterId, { ViewChannel: true, Connect: true, Speak: true })
      .catch(() => {});

    if (requester?.voice?.channelId === record.waitingRoomId) {
      await requester.voice.setChannel(voiceChannel, 'Accepted from waiting room').catch(() => {});
    }

    await interaction.update({
      content: `✅ <@${requesterId}> was **accepted** into **${voiceChannel.name}** by <@${interaction.user.id}>.`,
      components: [],
    });
  } else {
    if (requester?.voice?.channelId === record.waitingRoomId) {
      await requester.voice.disconnect('Denied from waiting room').catch(() => {});
    }

    await interaction.update({
      content: `❌ <@${requesterId}> was **denied** from joining **${voiceChannel.name}** by <@${interaction.user.id}>.`,
      components: [],
    });
  }
}

async function handleModal(interaction) {
  const [, modalType, channelId] = interaction.customId.split(':');
  const ctx = await resolveOwnedContext(interaction, {
    requireOwner: true,
    targetChannelId: channelId,
  });
  if (!ctx) return;

  if (modalType === 'name') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const newName = interaction.fields.getTextInputValue('channel_name');
    const res = await renameVoiceChannel(ctx.voiceChannel, newName);
    return replyEphemeral(interaction, res.message);
  }

  if (modalType === 'limit') {
    const rawLimit = interaction.fields.getTextInputValue('user_limit');
    const res = await setVoiceLimit(ctx.voiceChannel, rawLimit);
    return replyEphemeral(interaction, res.message);
  }
}

async function handleSelectMenu(interaction) {
  const [, action, channelId] = interaction.customId.split(':');
  const ctx = await resolveOwnedContext(interaction, {
    requireOwner: true,
    targetChannelId: channelId,
  });
  if (!ctx) return;

  const { voiceChannel, record } = ctx;
  const values = interaction.values;

  await interaction.deferUpdate();

  let res;
  switch (action) {
    case 'privacy':
      res = await setPrivacyMode(interaction.guild, record, voiceChannel, values[0]);
      break;
    case 'trust':
      res = await trustUsers(interaction.guild, record, voiceChannel, values);
      break;
    case 'untrust':
      res = await untrustUsers(interaction.guild, record, voiceChannel, values);
      break;
    case 'invite':
      res = await inviteUsers(voiceChannel, interaction.member, values);
      break;
    case 'kick':
      res = await kickMembers(record, voiceChannel, values);
      break;
    case 'region': {
      const regionVal = values[0] === 'auto' ? null : values[0];
      await voiceChannel.setRTCRegion(regionVal, 'Voice region updated by TempVoice owner');
      res = {
        ok: true,
        message: regionVal ? `🌐 Voice region set to **${regionVal}**.` : '🌐 Voice region set to **Automatic**.',
      };
      break;
    }
    case 'block':
      res = await blockUsers(interaction.guild, record, voiceChannel, values);
      break;
    case 'unblock':
      res = await unblockUsers(interaction.guild, record, voiceChannel, values);
      break;
    case 'transfer':
      res = await transferOwnership(interaction.guild, record, voiceChannel, values[0]);
      break;
    default:
      res = { ok: false, message: 'Unknown selection action.' };
  }

  await interaction.editReply({
    content: res.message,
    components: [],
  });
}

export async function handleComponentInteraction(interaction) {
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('mtv:')) {
        const key = interaction.customId.slice(4);
        return await handleMainButton(interaction, key);
      }
      if (interaction.customId.startsWith('mtv_wait:')) {
        return await handleWaitingButton(interaction, interaction.customId.split(':'));
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('mtv_modal:')) {
      return await handleModal(interaction);
    }

    if (interaction.isAnySelectMenu() && interaction.customId.startsWith('mtv_select:')) {
      return await handleSelectMenu(interaction);
    }
  } catch (err) {
    console.error('[Interaction] Error handling component:', err);
    await replyEphemeral(interaction, `An error occurred: ${err.message}`).catch(() => {});
  }
}

