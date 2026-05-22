#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  GuildVerificationLevel,
  GuildDefaultMessageNotifications,
} from "discord.js";

// Prefer the legacy DISCORD_BOT_TOKEN (used when this MCP server is invoked
// standalone via Claude Code on a host with its own bot app), but fall back to
// KURUMI_BOT_TOKEN when embedded inside the kurumi-chat-bot container so the
// whole stack can run on a single Discord application.
const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.KURUMI_BOT_TOKEN;
if (!TOKEN) {
  console.error("No bot token found. Set DISCORD_BOT_TOKEN (standalone) or KURUMI_BOT_TOKEN (embedded).");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ready = new Promise((resolve) => client.once("clientReady", resolve));
client.login(TOKEN).catch((e) => {
  console.error("Discord login failed:", e.message);
  process.exit(1);
});

const ok = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
const err = (e) => ({
  isError: true,
  content: [{ type: "text", text: `Error: ${e?.message ?? String(e)}` }],
});

async function getGuild(guildId) {
  await ready;
  const g = await client.guilds.fetch(guildId);
  await g.channels.fetch();
  await g.roles.fetch();
  return g;
}

const CHANNEL_TYPE_MAP = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
  media: ChannelType.GuildMedia,
};

const PERMISSION_NAMES = Object.keys(PermissionFlagsBits);

function resolvePerms(list) {
  if (!list?.length) return undefined;
  return list.map((name) => {
    const flag = PermissionFlagsBits[name];
    if (flag === undefined) throw new Error(`Unknown permission: ${name}`);
    return flag;
  });
}

function channelSummary(c) {
  return {
    id: c.id,
    name: c.name,
    type: Object.keys(CHANNEL_TYPE_MAP).find((k) => CHANNEL_TYPE_MAP[k] === c.type) ?? c.type,
    parentId: c.parentId ?? null,
    position: c.rawPosition ?? c.position ?? null,
    topic: c.topic ?? null,
    nsfw: c.nsfw ?? null,
  };
}
function roleSummary(r) {
  return {
    id: r.id,
    name: r.name,
    color: r.hexColor,
    hoist: r.hoist,
    mentionable: r.mentionable,
    position: r.position,
    managed: r.managed,
    permissions: r.permissions.toArray(),
  };
}

const server = new McpServer({ name: "discord-server-bot", version: "0.1.0" });

server.registerTool(
  "list_guilds",
  {
    title: "List guilds",
    description: "List every guild this bot is a member of.",
    inputSchema: {},
  },
  async () => {
    await ready;
    const guilds = await client.guilds.fetch();
    const out = [];
    for (const [, g] of guilds) {
      out.push({ id: g.id, name: g.name });
    }
    return ok(out);
  }
);

server.registerTool(
  "get_guild_info",
  {
    title: "Get guild info",
    description: "Return channels, categories, and roles for a guild.",
    inputSchema: { guildId: z.string() },
  },
  async ({ guildId }) => {
    try {
      const g = await getGuild(guildId);
      return ok({
        id: g.id,
        name: g.name,
        verificationLevel: GuildVerificationLevel[g.verificationLevel],
        defaultMessageNotifications: GuildDefaultMessageNotifications[g.defaultMessageNotifications],
        channels: g.channels.cache.map(channelSummary).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
        roles: g.roles.cache.map(roleSummary).sort((a, b) => b.position - a.position),
      });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "list_permissions",
  {
    title: "List permission flag names",
    description: "Names accepted by permission arrays in other tools.",
    inputSchema: {},
  },
  async () => ok(PERMISSION_NAMES)
);

server.registerTool(
  "create_category",
  {
    title: "Create a category",
    description: "Create a category (channel group) in a guild.",
    inputSchema: {
      guildId: z.string(),
      name: z.string(),
      position: z.number().int().optional(),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, name, position, reason }) => {
    try {
      const g = await getGuild(guildId);
      const c = await g.channels.create({ name, type: ChannelType.GuildCategory, position, reason });
      return ok(channelSummary(c));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "create_channel",
  {
    title: "Create a channel",
    description: "Create a text/voice/announcement/stage/forum/media channel, optionally under a category, with optional permission overwrites.",
    inputSchema: {
      guildId: z.string(),
      name: z.string(),
      type: z.enum(["text", "voice", "announcement", "stage", "forum", "media"]),
      parentId: z.string().optional().describe("Category ID to nest under."),
      topic: z.string().optional(),
      nsfw: z.boolean().optional(),
      slowmodeSeconds: z.number().int().min(0).max(21600).optional(),
      userLimit: z.number().int().min(0).max(99).optional().describe("Voice/stage only."),
      bitrate: z.number().int().optional().describe("Voice/stage only."),
      position: z.number().int().optional(),
      permissionOverwrites: z
        .array(
          z.object({
            id: z.string().describe("Role or member ID. Use guildId for @everyone."),
            allow: z.array(z.string()).optional(),
            deny: z.array(z.string()).optional(),
          })
        )
        .optional(),
      reason: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const g = await getGuild(args.guildId);
      const overwrites = args.permissionOverwrites?.map((o) => ({
        id: o.id,
        allow: resolvePerms(o.allow),
        deny: resolvePerms(o.deny),
      }));
      const c = await g.channels.create({
        name: args.name,
        type: CHANNEL_TYPE_MAP[args.type],
        parent: args.parentId,
        topic: args.topic,
        nsfw: args.nsfw,
        rateLimitPerUser: args.slowmodeSeconds,
        userLimit: args.userLimit,
        bitrate: args.bitrate,
        position: args.position,
        permissionOverwrites: overwrites,
        reason: args.reason,
      });
      return ok(channelSummary(c));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "update_channel",
  {
    title: "Update a channel",
    description: "Rename or modify an existing channel.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      name: z.string().optional(),
      topic: z.string().optional(),
      nsfw: z.boolean().optional(),
      slowmodeSeconds: z.number().int().optional(),
      parentId: z.string().nullable().optional(),
      position: z.number().int().optional(),
      reason: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const g = await getGuild(args.guildId);
      const ch = await g.channels.fetch(args.channelId);
      const updated = await ch.edit({
        name: args.name,
        topic: args.topic,
        nsfw: args.nsfw,
        rateLimitPerUser: args.slowmodeSeconds,
        parent: args.parentId,
        position: args.position,
        reason: args.reason,
      });
      return ok(channelSummary(updated));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "send_message",
  {
    title: "Send a message to a channel",
    description: "Post a message to a text channel. Supports markdown and multi-line content.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      content: z.string(),
    },
  },
  async ({ guildId, channelId, content }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const msg = await ch.send({ content });
      return ok({ channelId, messageId: msg.id });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "delete_channel",
  {
    title: "Delete a channel",
    description: "Delete a channel or category by ID.",
    inputSchema: { guildId: z.string(), channelId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, channelId, reason }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      await ch.delete(reason);
      return ok({ deleted: channelId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "set_channel_permissions",
  {
    title: "Set channel permission overwrite",
    description: "Add or update a permission overwrite for a role or member on a channel. Use guildId as targetId for @everyone.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      targetId: z.string(),
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, channelId, targetId, allow, deny, reason }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const overwrite = {};
      if (allow) for (const p of allow) overwrite[p] = true;
      if (deny) for (const p of deny) overwrite[p] = false;
      await ch.permissionOverwrites.edit(targetId, overwrite, { reason });
      return ok({ channelId, targetId, applied: overwrite });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "create_role",
  {
    title: "Create a role",
    description: "Create a role with optional color, hoist, mentionable, and permission list.",
    inputSchema: {
      guildId: z.string(),
      name: z.string(),
      color: z.union([z.string(), z.number()]).optional().describe("Hex like '#5865F2' or integer."),
      hoist: z.boolean().optional(),
      mentionable: z.boolean().optional(),
      permissions: z.array(z.string()).optional(),
      position: z.number().int().optional(),
      reason: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const g = await getGuild(args.guildId);
      const role = await g.roles.create({
        name: args.name,
        color: args.color,
        hoist: args.hoist,
        mentionable: args.mentionable,
        permissions: resolvePerms(args.permissions),
        position: args.position,
        reason: args.reason,
      });
      return ok(roleSummary(role));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "update_role",
  {
    title: "Update a role",
    description: "Modify an existing role.",
    inputSchema: {
      guildId: z.string(),
      roleId: z.string(),
      name: z.string().optional(),
      color: z.union([z.string(), z.number()]).optional(),
      hoist: z.boolean().optional(),
      mentionable: z.boolean().optional(),
      permissions: z.array(z.string()).optional(),
      position: z.number().int().optional(),
      reason: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const g = await getGuild(args.guildId);
      const role = await g.roles.fetch(args.roleId);
      const updated = await role.edit({
        name: args.name,
        color: args.color,
        hoist: args.hoist,
        mentionable: args.mentionable,
        permissions: resolvePerms(args.permissions),
        position: args.position,
        reason: args.reason,
      });
      return ok(roleSummary(updated));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "delete_role",
  {
    title: "Delete a role",
    description: "Delete a role by ID.",
    inputSchema: { guildId: z.string(), roleId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, roleId, reason }) => {
    try {
      const g = await getGuild(guildId);
      const role = await g.roles.fetch(roleId);
      await role.delete(reason);
      return ok({ deleted: roleId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "update_guild",
  {
    title: "Update guild settings",
    description: "Edit guild name, verification level, default notifications, or icon.",
    inputSchema: {
      guildId: z.string(),
      name: z.string().optional(),
      verificationLevel: z.enum(["None", "Low", "Medium", "High", "VeryHigh"]).optional(),
      defaultMessageNotifications: z.enum(["AllMessages", "OnlyMentions"]).optional(),
      iconUrlOrPath: z.string().optional().describe("URL or local file path to an image for the guild icon."),
      reason: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const g = await getGuild(args.guildId);
      const updated = await g.edit({
        name: args.name,
        verificationLevel: args.verificationLevel ? GuildVerificationLevel[args.verificationLevel] : undefined,
        defaultMessageNotifications: args.defaultMessageNotifications
          ? GuildDefaultMessageNotifications[args.defaultMessageNotifications]
          : undefined,
        icon: args.iconUrlOrPath,
        reason: args.reason,
      });
      return ok({ id: updated.id, name: updated.name });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "apply_template",
  {
    title: "Apply a server template",
    description:
      "Declaratively create roles, categories, and channels from a single config. Idempotent by name — existing items are reused.",
    inputSchema: {
      guildId: z.string(),
      template: z.object({
        roles: z
          .array(
            z.object({
              name: z.string(),
              color: z.union([z.string(), z.number()]).optional(),
              hoist: z.boolean().optional(),
              mentionable: z.boolean().optional(),
              permissions: z.array(z.string()).optional(),
            })
          )
          .optional(),
        categories: z
          .array(
            z.object({
              name: z.string(),
              channels: z
                .array(
                  z.object({
                    name: z.string(),
                    type: z.enum(["text", "voice", "announcement", "stage", "forum", "media"]).default("text"),
                    topic: z.string().optional(),
                    nsfw: z.boolean().optional(),
                    slowmodeSeconds: z.number().int().optional(),
                  })
                )
                .optional(),
              permissionOverwrites: z
                .array(
                  z.object({
                    roleName: z.string().describe("Use '@everyone' for the everyone role."),
                    allow: z.array(z.string()).optional(),
                    deny: z.array(z.string()).optional(),
                  })
                )
                .optional(),
            })
          )
          .optional(),
      }),
    },
  },
  async ({ guildId, template }) => {
    try {
      const g = await getGuild(guildId);
      const created = { roles: [], categories: [], channels: [] };

      for (const r of template.roles ?? []) {
        const existing = g.roles.cache.find((x) => x.name === r.name);
        if (existing) { created.roles.push({ ...roleSummary(existing), reused: true }); continue; }
        const role = await g.roles.create({
          name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
          permissions: resolvePerms(r.permissions),
        });
        created.roles.push(roleSummary(role));
      }

      for (const cat of template.categories ?? []) {
        let category = g.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === cat.name
        );
        if (!category) {
          category = await g.channels.create({ name: cat.name, type: ChannelType.GuildCategory });
        }
        created.categories.push(channelSummary(category));

        if (cat.permissionOverwrites?.length) {
          for (const ow of cat.permissionOverwrites) {
            const target = ow.roleName === "@everyone"
              ? g.id
              : g.roles.cache.find((r) => r.name === ow.roleName)?.id;
            if (!target) throw new Error(`Role not found for overwrite: ${ow.roleName}`);
            const patch = {};
            for (const p of ow.allow ?? []) patch[p] = true;
            for (const p of ow.deny ?? []) patch[p] = false;
            await category.permissionOverwrites.edit(target, patch);
          }
        }

        for (const ch of cat.channels ?? []) {
          const existing = g.channels.cache.find(
            (c) => c.parentId === category.id && c.name === ch.name
          );
          if (existing) { created.channels.push({ ...channelSummary(existing), reused: true }); continue; }
          const channel = await g.channels.create({
            name: ch.name,
            type: CHANNEL_TYPE_MAP[ch.type],
            parent: category.id,
            topic: ch.topic,
            nsfw: ch.nsfw,
            rateLimitPerUser: ch.slowmodeSeconds,
          });
          created.channels.push(channelSummary(channel));
        }
      }

      return ok(created);
    } catch (e) { return err(e); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("discord-server-bot MCP server connected on stdio.");

const shutdown = async () => { try { await client.destroy(); } catch {} process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
