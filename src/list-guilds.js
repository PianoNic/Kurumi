#!/usr/bin/env node
// Helper: print every guild the bot is in, with IDs. Useful for finding guildId.
import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.KURUMI_BOT_TOKEN;
if (!TOKEN) { console.error("No bot token found (set DISCORD_BOT_TOKEN or KURUMI_BOT_TOKEN)"); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("clientReady", async () => {
  const guilds = await client.guilds.fetch();
  if (!guilds.size) console.log("(bot is not in any guild — invite it first)");
  for (const [, g] of guilds) console.log(`${g.id}  ${g.name}`);
  await client.destroy();
  process.exit(0);
});
client.login(TOKEN);
