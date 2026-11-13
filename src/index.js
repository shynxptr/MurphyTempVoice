import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} from 'discord.js';
import { assertConfig, config } from './config.js';
import { loadStore } from './store.js';
import { syncApplicationEmojis } from './emojis.js';
import { commandBuilders, handleSlashCommand } from './commands/commands.js';
import { handleComponentInteraction } from './handlers/buttonHandler.js';
import {
  handleVoiceStateUpdate,
  reconcileOnStartup,
} from './services/voiceManager.js';

assertConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

async function registerSlashCommands(applicationId) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = commandBuilders.map((b) => b.toJSON());
  await rest.put(Routes.applicationCommands(applicationId), { body });
  console.log(`[Commands] Registered ${body.length} global slash commands.`);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[Ready] Murphy Temp Voice logged in as ${readyClient.user.tag}`);

  await syncApplicationEmojis(readyClient, {
    uploadMissing: config.autoSyncAppEmojis,
  });

  try {
    await registerSlashCommands(readyClient.application.id);
  } catch (err) {
    console.error('[Commands] Failed to register slash commands:', err.message);
  }

  await reconcileOnStartup(readyClient);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    await handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    console.error('[VoiceStateUpdate] Unhandled error:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
    return;
  }

  if (interaction.isButton() || interaction.isModalSubmit() || interaction.isAnySelectMenu()) {
    await handleComponentInteraction(interaction);
  }
});

async function main() {
  await loadStore();
  await client.login(config.token);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});

