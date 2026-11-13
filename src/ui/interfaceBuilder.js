import path from 'node:path';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { ASSETS_DIR } from '../config.js';
import { BUTTON_DEFINITIONS, resolveButtonEmoji } from '../emojis.js';

export function buildInterfacePayload(guild = null) {
  const bannerPath = path.join(ASSETS_DIR, 'interface-banner.png');
  const bannerAttachment = new AttachmentBuilder(bannerPath, { name: 'interface-banner.png' });

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('Murphy Temp Voice Interface')
    .setDescription(
      'This **interface** can be used to manage temporary voice channels.\n' +
        'More options are available with `/voice` commands.\n\n' +
        'Join the **Join to Create** channel to create your own room and use the buttons below to configure it.'
    )
    .setImage('attachment://interface-banner.png')
    .setFooter({ text: 'Murphy Temp Voice • Rooms stay alive while an authorized AFK/Music bot is inside' });

  const rows = [];
  for (let i = 0; i < BUTTON_DEFINITIONS.length; i += 5) {
    const chunk = BUTTON_DEFINITIONS.slice(i, i + 5);
    const row = new ActionRowBuilder().addComponents(
      chunk.map((def) =>
        new ButtonBuilder()
          .setCustomId(`mtv:${def.key}`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(resolveButtonEmoji(def.key, guild))
      )
    );
    rows.push(row);
  }

  return {
    embeds: [embed],
    components: rows,
    files: [bannerAttachment],
  };
}

