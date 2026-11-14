import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from '../config.js';
import {
  getGuildConfig,
  getTempChannel,
  setGuildConfig,
} from '../store.js';
import { buildInterfacePayload } from '../ui/interfaceBuilder.js';
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
import {
  getEffectiveAllowAnyBot,
  getEffectiveStayBotIds,
} from '../services/voiceManager.js';

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Setup Murphy Temp Voice category, Join-to-Create channel, and interface panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt
        .setName('category')
        .setDescription('Existing category for TempVoice channels (optional)')
        .addChannelTypes(ChannelType.GuildCategory)
    )
    .addChannelOption((opt) =>
      opt
        .setName('interface_channel')
        .setDescription('Existing text channel for the interface panel (optional)')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addChannelOption((opt) =>
      opt
        .setName('join_channel')
        .setDescription('Existing Join-to-Create voice channel (optional)')
        .addChannelTypes(ChannelType.GuildVoice)
    )
    .addStringOption((opt) =>
      opt
        .setName('name_template')
        .setDescription("Default channel name template, e.g. {username}'s VC")
        .setMaxLength(80)
    ),

  new SlashCommandBuilder()
    .setName('afk-bots')
    .setDescription('Manage whitelisted AFK/Music bots that keep TempVoice channels alive')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a bot to the TempVoice keep-alive whitelist')
        .addUserOption((opt) =>
          opt.setName('bot').setDescription('The AFK/Music bot user').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a bot from this server whitelist')
        .addUserOption((opt) =>
          opt.setName('bot').setDescription('The bot to remove').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all whitelisted AFK/Music bots')
    )
    .addSubcommand((sub) =>
      sub
        .setName('any-bot')
        .setDescription('Allow or disallow ANY bot from keeping TempVoice channels alive')
        .addBooleanOption((opt) =>
          opt.setName('enabled').setDescription('True = any bot keeps room alive').setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Manage your active Murphy Temp Voice channel')
    .addSubcommand((sub) =>
      sub
        .setName('name')
        .setDescription('Rename your voice channel')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(100)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('limit')
        .setDescription('Set user limit (0 = unlimited, max 99)')
        .addIntegerOption((opt) =>
          opt.setName('count').setDescription('User limit').setRequired(true).setMinValue(0).setMaxValue(99)
        )
    )
    .addSubcommand((sub) => sub.setName('lock').setDescription('Lock your voice channel'))
    .addSubcommand((sub) => sub.setName('unlock').setDescription('Unlock your voice channel'))
    .addSubcommand((sub) => sub.setName('ghost').setDescription('Hide your voice channel'))
    .addSubcommand((sub) => sub.setName('unghost').setDescription('Make your voice channel visible'))
    .addSubcommand((sub) => sub.setName('waiting-room').setDescription('Toggle waiting room'))
    .addSubcommand((sub) => sub.setName('chat').setDescription('Toggle private text chat'))
    .addSubcommand((sub) =>
      sub
        .setName('trust')
        .setDescription('Trust a user in your voice channel')
        .addUserOption((opt) => opt.setName('user').setDescription('User to trust').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('untrust')
        .setDescription('Remove trust from a user')
        .addUserOption((opt) => opt.setName('user').setDescription('User to untrust').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('invite')
        .setDescription('Invite a user to your voice channel via DM')
        .addUserOption((opt) => opt.setName('user').setDescription('User to invite').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('Kick a member from your voice channel')
        .addUserOption((opt) => opt.setName('user').setDescription('User to kick').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('block')
        .setDescription('Block a user from your voice channel')
        .addUserOption((opt) => opt.setName('user').setDescription('User to block').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('unblock')
        .setDescription('Unblock a user from your voice channel')
        .addUserOption((opt) => opt.setName('user').setDescription('User to unblock').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('claim').setDescription('Claim ownership if owner left'))
    .addSubcommand((sub) =>
      sub
        .setName('transfer')
        .setDescription('Transfer ownership to another member in the channel')
        .addUserOption((opt) => opt.setName('user').setDescription('New owner').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete your voice channel'))
    .addSubcommand((sub) => sub.setName('info').setDescription('Show status of your voice channel')),
];

async function handleSetup(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  let category = interaction.options.getChannel('category');
  let interfaceCh = interaction.options.getChannel('interface_channel');
  let joinCh = interaction.options.getChannel('join_channel');
  const nameTemplate = interaction.options.getString('name_template') || "{username}'s VC";

  if (!category) {
    category = await guild.channels.create({
      name: 'Murphy Temp Voice',
      type: ChannelType.GuildCategory,
    });
  }

  if (!interfaceCh) {
    interfaceCh = await guild.channels.create({
      name: 'interface',
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: guild.members.me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
          ],
        },
      ],
    });
  }

  if (!joinCh) {
    joinCh = await guild.channels.create({
      name: '➕ Join to Create',
      type: ChannelType.GuildVoice,
      parent: category.id,
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
      ],
    });
  }

  const requiredPerms = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['Connect', PermissionFlagsBits.Connect],
    ['ManageChannels', PermissionFlagsBits.ManageChannels],
    ['MoveMembers', PermissionFlagsBits.MoveMembers],
  ];
  const me = guild.members.me;
  const joinPerms = joinCh.permissionsFor(me);
  const catPerms = category.permissionsFor(me);
  const missingJoin = requiredPerms
    .filter(([, flag]) => !joinPerms?.has(flag))
    .map(([label]) => label);
  const missingCat = requiredPerms
    .filter(([, flag]) => !catPerms?.has(flag))
    .map(([label]) => label);

  const permWarnings = [];
  if (missingJoin.length) {
    permWarnings.push(`⚠️ Bot missing permissions in <#${joinCh.id}>: **${missingJoin.join(', ')}**`);
  }
  if (missingCat.length) {
    permWarnings.push(`⚠️ Bot missing permissions in category <#${category.id}>: **${missingCat.join(', ')}**`);
  }

  const payload = buildInterfacePayload(guild);
  const sentMessage = await interfaceCh.send(payload);

  await setGuildConfig(guild.id, {
    categoryId: category.id,
    interfaceChannelId: interfaceCh.id,
    interfaceMessageId: sentMessage.id,
    joinToCreateChannelId: joinCh.id,
    defaultNameTemplate: nameTemplate,
  });

  await interaction.editReply(
    `✅ **Murphy Temp Voice** setup complete!\n` +
      `• Category: <#${category.id}>\n` +
      `• Interface: <#${interfaceCh.id}>\n` +
      `• Join to Create: <#${joinCh.id}>\n` +
      `• Grace period when empty: **${config.emptyGraceSeconds}s**\n\n` +
      (permWarnings.length ? `${permWarnings.join('\n')}\n\n` : '') +
      `Use \`/afk-bots add\` (or \`STAY_BOT_IDS\` in \`.env\`) to whitelist your Murphy Music/AFK bot.`
  );
}

async function handleAfkBots(interaction) {
  const guild = interaction.guild;
  const sub = interaction.options.getSubcommand();
  const guildCfg = getGuildConfig(guild.id) ?? {};
  const list = new Set(guildCfg.stayBotIds ?? []);

  if (sub === 'add') {
    const user = interaction.options.getUser('bot', true);
    if (!user.bot) {
      return interaction.reply({
        content: `⚠️ <@${user.id}> is not a bot account. Only bot accounts should be added to the AFK whitelist.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    list.add(user.id);
    await setGuildConfig(guild.id, { stayBotIds: [...list] });
    return interaction.reply({
      content: `✅ Added <@${user.id}> (\`${user.id}\`) to the AFK/Music bot keep-alive whitelist.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'remove') {
    const user = interaction.options.getUser('bot', true);
    list.delete(user.id);
    await setGuildConfig(guild.id, { stayBotIds: [...list] });
    return interaction.reply({
      content: `🗑️ Removed <@${user.id}> from this server's AFK whitelist.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'any-bot') {
    const enabled = interaction.options.getBoolean('enabled', true);
    await setGuildConfig(guild.id, { allowAnyBotStay: enabled });
    return interaction.reply({
      content: enabled
        ? '✅ **Any bot** connected to a TempVoice channel will now keep it alive.'
        : '🔒 Only **whitelisted AFK/Music bots** will keep TempVoice channels alive.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'list') {
    const effective = [...getEffectiveStayBotIds(guildCfg)];
    const anyBot = getEffectiveAllowAnyBot(guildCfg);
    const formatted = effective.length
      ? effective.map((id) => `• <@${id}> (\`${id}\`)`).join('\n')
      : '_None configured yet._';

    return interaction.reply({
      content:
        `**Murphy Temp Voice — AFK Keep-Alive Bots**\n` +
        `• Allow any bot: **${anyBot ? 'Yes' : 'No (Whitelist only)'}**\n` +
        `• Empty grace period: **${config.emptyGraceSeconds}s**\n` +
        `• Whitelisted bots:\n${formatted}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleVoiceCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply({
      content: 'You must be connected to a voice channel first.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const record = getTempChannel(voiceChannel.id);
  if (!record) {
    return interaction.reply({
      content: 'This voice channel is not a **Murphy Temp Voice** channel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'info') {
    const guildCfg = getGuildConfig(interaction.guild.id);
    const stayBotIds = getEffectiveStayBotIds(guildCfg);
    const anyBot = getEffectiveAllowAnyBot(guildCfg);
    const activeAfkBots = [...voiceChannel.members.values()].filter(
      (m) => m.user.bot && (anyBot || stayBotIds.has(m.id))
    );

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`🎙️ ${voiceChannel.name}`)
      .addFields(
        { name: 'Owner', value: `<@${record.ownerId}>`, inline: true },
        {
          name: 'Limit',
          value: voiceChannel.userLimit ? `${voiceChannel.userLimit}` : 'Unlimited',
          inline: true,
        },
        {
          name: 'Privacy',
          value: record.hidden ? 'Invisible' : record.locked ? 'Locked' : 'Unlocked',
          inline: true,
        },
        {
          name: 'AFK Guard Bot',
          value: activeAfkBots.length
            ? activeAfkBots.map((b) => `<@${b.id}>`).join(', ')
            : 'None in room',
          inline: false,
        }
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'claim') {
    const res = await claimChannel(interaction.guild, record, voiceChannel, member);
    return interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
  }

  if (record.ownerId !== interaction.user.id) {
    return interaction.reply({
      content: `Only the room owner (<@${record.ownerId}>) can use this command.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let res;
  switch (sub) {
    case 'name':
      res = await renameVoiceChannel(voiceChannel, interaction.options.getString('name', true));
      break;
    case 'limit':
      res = await setVoiceLimit(voiceChannel, interaction.options.getInteger('count', true));
      break;
    case 'lock':
      res = await setPrivacyMode(interaction.guild, record, voiceChannel, 'lock');
      break;
    case 'unlock':
      res = await setPrivacyMode(interaction.guild, record, voiceChannel, 'unlock');
      break;
    case 'ghost':
      res = await setPrivacyMode(interaction.guild, record, voiceChannel, 'invisible');
      break;
    case 'unghost':
      res = await setPrivacyMode(interaction.guild, record, voiceChannel, 'visible');
      break;
    case 'waiting-room':
      res = await toggleWaitingRoom(interaction.guild, record, voiceChannel);
      break;
    case 'chat':
      res = await togglePrivateChat(interaction.guild, record, voiceChannel);
      break;
    case 'trust':
      res = await trustUsers(interaction.guild, record, voiceChannel, [
        interaction.options.getUser('user', true).id,
      ]);
      break;
    case 'untrust':
      res = await untrustUsers(interaction.guild, record, voiceChannel, [
        interaction.options.getUser('user', true).id,
      ]);
      break;
    case 'invite':
      res = await inviteUsers(voiceChannel, member, [
        interaction.options.getUser('user', true).id,
      ]);
      break;
    case 'kick':
      res = await kickMembers(record, voiceChannel, [
        interaction.options.getUser('user', true).id,
      ]);
      break;
    case 'block':
      res = await blockUsers(interaction.guild, record, voiceChannel, [
        interaction.options.getUser('user', true).id,
      ]);
      break;
    case 'unblock':
      res = await unblockUsers(interaction.guild, record, voiceChannel, [
        interaction.options.getUser('user', true).id,
      ]);
      break;
    case 'transfer':
      res = await transferOwnership(
        interaction.guild,
        record,
        voiceChannel,
        interaction.options.getUser('user', true).id
      );
      break;
    case 'delete':
      res = await deleteOwnerChannel(interaction.guild, record);
      break;
    default:
      res = { ok: false, message: 'Unknown subcommand.' };
  }

  return interaction.editReply(res.message);
}

export async function handleSlashCommand(interaction) {
  try {
    if (interaction.commandName === 'setup') return await handleSetup(interaction);
    if (interaction.commandName === 'afk-bots') return await handleAfkBots(interaction);
    if (interaction.commandName === 'voice') return await handleVoiceCommand(interaction);
  } catch (err) {
    console.error('[SlashCommand] Error:', err);
    const payload = { content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}

