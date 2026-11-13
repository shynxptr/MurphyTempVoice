import { Client, Events, GatewayIntentBits } from 'discord.js';
import { assertConfig, config } from '../config.js';
import { syncApplicationEmojis } from '../emojis.js';

assertConfig();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const map = await syncApplicationEmojis(client, { uploadMissing: true });
  console.log(`Synced ${map.size}/15 Application Emojis.`);
  client.destroy();
  process.exit(0);
});

client.login(config.token);
