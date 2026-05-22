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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,            // privileged — for member ops
    GatewayIntentBits.GuildMessages,           // for reading channel history
    GatewayIntentBits.MessageContent,          // privileged — for actual message text
    GatewayIntentBits.GuildMessageReactions,   // for reaction tools
    GatewayIntentBits.GuildModeration,         // for kick/ban/audit-log events
    GatewayIntentBits.GuildExpressions,        // for emoji + sticker management
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,        // for move/disconnect from voice
    GatewayIntentBits.DirectMessages,          // for send_dm
  ],
});
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

function messageSummary(m) {
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.author?.id,
    authorName: m.author?.username,
    authorBot: !!m.author?.bot,
    content: m.content,
    cleanContent: m.cleanContent,
    createdAt: m.createdAt?.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    pinned: m.pinned,
    attachments: [...(m.attachments?.values() ?? [])].map((a) => ({
      id: a.id, name: a.name, url: a.url, contentType: a.contentType, size: a.size,
    })),
    embeds: m.embeds?.length ?? 0,
    referencedMessageId: m.reference?.messageId ?? null,
    reactions: [...(m.reactions?.cache?.values() ?? [])].map((r) => ({
      emoji: r.emoji.name ?? r.emoji.id, count: r.count,
    })),
  };
}
function memberSummary(m) {
  return {
    id: m.id,
    username: m.user?.username,
    displayName: m.displayName,
    nickname: m.nickname ?? null,
    bot: !!m.user?.bot,
    joinedAt: m.joinedAt?.toISOString() ?? null,
    roleIds: [...m.roles.cache.keys()].filter((id) => id !== m.guild.id),
    communicationDisabledUntil: m.communicationDisabledUntil?.toISOString() ?? null,
    premiumSince: m.premiumSince?.toISOString() ?? null,
  };
}

const server = new McpServer({ name: "discord-server-bot", version: "0.2.0" });

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

// ─── MESSAGES ───────────────────────────────────────────────────────────────

server.registerTool(
  "fetch_messages",
  {
    title: "Fetch messages from a channel",
    description:
      "Read the most recent messages in a text channel. Use `before` / `after` / `around` (message IDs) for paging. Returns up to 100 messages per call.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      limit: z.number().int().min(1).max(100).optional().describe("Default 50."),
      before: z.string().optional(),
      after: z.string().optional(),
      around: z.string().optional(),
    },
  },
  async ({ guildId, channelId, limit, before, after, around }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const msgs = await ch.messages.fetch({ limit: limit ?? 50, before, after, around });
      return ok([...msgs.values()].map(messageSummary));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "get_message",
  {
    title: "Get one message by ID",
    description: "Fetch a single message with full detail (reactions, embeds, attachments, reference).",
    inputSchema: { guildId: z.string(), channelId: z.string(), messageId: z.string() },
  },
  async ({ guildId, channelId, messageId }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const m = await ch.messages.fetch(messageId);
      return ok(messageSummary(m));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "edit_message",
  {
    title: "Edit a message",
    description: "Edit a message the bot itself authored. Cannot edit other users' messages.",
    inputSchema: { guildId: z.string(), channelId: z.string(), messageId: z.string(), content: z.string() },
  },
  async ({ guildId, channelId, messageId, content }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const m = await ch.messages.fetch(messageId);
      const edited = await m.edit({ content });
      return ok(messageSummary(edited));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "delete_message",
  {
    title: "Delete a message",
    description: "Delete any message in a channel (needs Manage Messages for others' messages).",
    inputSchema: { guildId: z.string(), channelId: z.string(), messageId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, channelId, messageId, reason }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const m = await ch.messages.fetch(messageId);
      await m.delete(reason);
      return ok({ deleted: messageId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "bulk_delete_messages",
  {
    title: "Bulk-delete recent messages",
    description: "Delete up to 100 messages at once. Discord only allows bulk-delete for messages newer than 14 days.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      count: z.number().int().min(2).max(100).optional().describe("Default 50."),
    },
  },
  async ({ guildId, channelId, count }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const deleted = await ch.bulkDelete(count ?? 50, true);
      return ok({ deleted: deleted.size });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "pin_message",
  {
    title: "Pin a message",
    description: "Pin a message to its channel.",
    inputSchema: { guildId: z.string(), channelId: z.string(), messageId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, channelId, messageId, reason }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const m = await ch.messages.fetch(messageId);
      await m.pin(reason);
      return ok({ pinned: messageId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "unpin_message",
  {
    title: "Unpin a message",
    description: "Remove a pinned message from its channel.",
    inputSchema: { guildId: z.string(), channelId: z.string(), messageId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, channelId, messageId, reason }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const m = await ch.messages.fetch(messageId);
      await m.unpin(reason);
      return ok({ unpinned: messageId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "list_pinned_messages",
  {
    title: "List pinned messages in a channel",
    description: "Return all currently-pinned messages in a channel.",
    inputSchema: { guildId: z.string(), channelId: z.string() },
  },
  async ({ guildId, channelId }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const pins = await ch.messages.fetchPinned();
      return ok([...pins.values()].map(messageSummary));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "add_reaction",
  {
    title: "React to a message",
    description: "Add a reaction. Emoji can be a unicode char (😺) or a custom emoji ID, or the literal 'name:id' form.",
    inputSchema: { guildId: z.string(), channelId: z.string(), messageId: z.string(), emoji: z.string() },
  },
  async ({ guildId, channelId, messageId, emoji }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const m = await ch.messages.fetch(messageId);
      const r = await m.react(emoji);
      return ok({ reacted: emoji, count: r.count });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "remove_reaction",
  {
    title: "Remove a reaction the bot added",
    description: "Remove the bot's own reaction from a message.",
    inputSchema: { guildId: z.string(), channelId: z.string(), messageId: z.string(), emoji: z.string() },
  },
  async ({ guildId, channelId, messageId, emoji }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const m = await ch.messages.fetch(messageId);
      const reaction = m.reactions.cache.find((r) => (r.emoji.name === emoji) || (r.emoji.id === emoji));
      if (reaction) await reaction.users.remove(client.user.id);
      return ok({ removed: emoji });
    } catch (e) { return err(e); }
  }
);

// ─── MEMBERS / MODERATION ───────────────────────────────────────────────────

server.registerTool(
  "list_members",
  {
    title: "List guild members",
    description: "Return guild members (up to 1000). Optional substring filter on username/displayname.",
    inputSchema: {
      guildId: z.string(),
      query: z.string().optional().describe("Case-insensitive substring filter on username or display name."),
      limit: z.number().int().min(1).max(1000).optional().describe("Default 200."),
    },
  },
  async ({ guildId, query, limit }) => {
    try {
      const g = await getGuild(guildId);
      await g.members.fetch();
      const q = query?.toLowerCase();
      const all = [...g.members.cache.values()];
      const filtered = q
        ? all.filter((m) => m.user.username.toLowerCase().includes(q) || (m.displayName ?? "").toLowerCase().includes(q))
        : all;
      return ok(filtered.slice(0, limit ?? 200).map(memberSummary));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "get_member",
  {
    title: "Get one member",
    description: "Detailed info for a single guild member.",
    inputSchema: { guildId: z.string(), userId: z.string() },
  },
  async ({ guildId, userId }) => {
    try {
      const g = await getGuild(guildId);
      const m = await g.members.fetch(userId);
      return ok(memberSummary(m));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "edit_member",
  {
    title: "Edit a member",
    description:
      "Modify nickname, add/remove roles, or set a communication timeout. Pass `addRoleIds` / `removeRoleIds` arrays. Pass `timeoutMinutes` (0 to clear).",
    inputSchema: {
      guildId: z.string(),
      userId: z.string(),
      nickname: z.string().nullable().optional(),
      addRoleIds: z.array(z.string()).optional(),
      removeRoleIds: z.array(z.string()).optional(),
      timeoutMinutes: z.number().int().min(0).max(40320).optional().describe("Up to 28 days. 0 clears timeout."),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, userId, nickname, addRoleIds, removeRoleIds, timeoutMinutes, reason }) => {
    try {
      const g = await getGuild(guildId);
      const m = await g.members.fetch(userId);
      if (nickname !== undefined) await m.setNickname(nickname, reason);
      if (addRoleIds?.length) await m.roles.add(addRoleIds, reason);
      if (removeRoleIds?.length) await m.roles.remove(removeRoleIds, reason);
      if (timeoutMinutes !== undefined) {
        await m.timeout(timeoutMinutes > 0 ? timeoutMinutes * 60_000 : null, reason);
      }
      const fresh = await g.members.fetch(userId);
      return ok(memberSummary(fresh));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "kick_member",
  {
    title: "Kick a member",
    description: "Remove a member from the guild. They can rejoin via invite.",
    inputSchema: { guildId: z.string(), userId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, userId, reason }) => {
    try {
      const g = await getGuild(guildId);
      const m = await g.members.fetch(userId);
      await m.kick(reason);
      return ok({ kicked: userId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "ban_member",
  {
    title: "Ban a member",
    description: "Permanently ban a user from the guild. Optionally delete their recent messages.",
    inputSchema: {
      guildId: z.string(),
      userId: z.string(),
      reason: z.string().optional(),
      deleteMessageDays: z.number().int().min(0).max(7).optional(),
    },
  },
  async ({ guildId, userId, reason, deleteMessageDays }) => {
    try {
      const g = await getGuild(guildId);
      await g.members.ban(userId, {
        reason,
        deleteMessageSeconds: deleteMessageDays ? deleteMessageDays * 24 * 3600 : undefined,
      });
      return ok({ banned: userId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "unban_member",
  {
    title: "Unban a user",
    description: "Lift a ban so the user may rejoin via invite.",
    inputSchema: { guildId: z.string(), userId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, userId, reason }) => {
    try {
      const g = await getGuild(guildId);
      await g.bans.remove(userId, reason);
      return ok({ unbanned: userId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "list_bans",
  {
    title: "List guild bans",
    description: "Return all currently-banned users.",
    inputSchema: { guildId: z.string() },
  },
  async ({ guildId }) => {
    try {
      const g = await getGuild(guildId);
      const bans = await g.bans.fetch();
      return ok([...bans.values()].map((b) => ({ id: b.user.id, username: b.user.username, reason: b.reason ?? null })));
    } catch (e) { return err(e); }
  }
);

// ─── THREADS ────────────────────────────────────────────────────────────────

server.registerTool(
  "create_thread",
  {
    title: "Create a thread",
    description: "Create a thread under a text channel, optionally from an existing message.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      name: z.string(),
      messageId: z.string().optional().describe("If set, the thread is anchored to this message."),
      autoArchiveMinutes: z.number().int().optional().describe("60, 1440, 4320, or 10080."),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, channelId, name, messageId, autoArchiveMinutes, reason }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      let thread;
      if (messageId) {
        const m = await ch.messages.fetch(messageId);
        thread = await m.startThread({ name, autoArchiveDuration: autoArchiveMinutes, reason });
      } else {
        thread = await ch.threads.create({ name, autoArchiveDuration: autoArchiveMinutes, reason });
      }
      return ok({ id: thread.id, name: thread.name, parentId: thread.parentId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "list_threads",
  {
    title: "List threads in a channel",
    description: "Return active threads under a channel (and optionally archived ones).",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      includeArchived: z.boolean().optional(),
    },
  },
  async ({ guildId, channelId, includeArchived }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const active = await ch.threads.fetchActive();
      const out = { active: [...active.threads.values()].map((t) => ({ id: t.id, name: t.name, archived: t.archived })) };
      if (includeArchived) {
        const archived = await ch.threads.fetchArchived();
        out.archived = [...archived.threads.values()].map((t) => ({ id: t.id, name: t.name, archived: true }));
      }
      return ok(out);
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "set_thread_archived",
  {
    title: "Archive / unarchive a thread",
    description: "Toggle a thread's archived state.",
    inputSchema: {
      guildId: z.string(),
      threadId: z.string(),
      archived: z.boolean(),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, threadId, archived, reason }) => {
    try {
      const g = await getGuild(guildId);
      const t = await g.channels.fetch(threadId);
      await t.setArchived(archived, reason);
      return ok({ id: threadId, archived });
    } catch (e) { return err(e); }
  }
);

// ─── INVITES ────────────────────────────────────────────────────────────────

server.registerTool(
  "create_invite",
  {
    title: "Create an invite",
    description: "Create an invite for a channel.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      maxAgeSeconds: z.number().int().min(0).max(604800).optional().describe("0 = never expires. Default 24h."),
      maxUses: z.number().int().min(0).max(100).optional().describe("0 = unlimited."),
      unique: z.boolean().optional(),
      temporary: z.boolean().optional().describe("If true, members are kicked on disconnect unless given a role."),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, channelId, maxAgeSeconds, maxUses, unique, temporary, reason }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const inv = await ch.createInvite({ maxAge: maxAgeSeconds, maxUses, unique, temporary, reason });
      return ok({ code: inv.code, url: inv.url, expiresAt: inv.expiresAt?.toISOString() ?? null, maxUses: inv.maxUses });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "list_invites",
  {
    title: "List guild invites",
    description: "Return all active invites in the guild.",
    inputSchema: { guildId: z.string() },
  },
  async ({ guildId }) => {
    try {
      const g = await getGuild(guildId);
      const invs = await g.invites.fetch();
      return ok([...invs.values()].map((i) => ({
        code: i.code, url: i.url, channelId: i.channelId, uses: i.uses, maxUses: i.maxUses,
        expiresAt: i.expiresAt?.toISOString() ?? null, inviterId: i.inviterId,
      })));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "delete_invite",
  {
    title: "Delete an invite",
    description: "Revoke an invite by code.",
    inputSchema: { guildId: z.string(), code: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, code, reason }) => {
    try {
      const g = await getGuild(guildId);
      await g.invites.delete(code, reason);
      return ok({ deleted: code });
    } catch (e) { return err(e); }
  }
);

// ─── VOICE ──────────────────────────────────────────────────────────────────

server.registerTool(
  "move_member_voice",
  {
    title: "Move a member between voice channels",
    description: "Move a connected member to another voice channel. Pass null channelId to disconnect them.",
    inputSchema: {
      guildId: z.string(),
      userId: z.string(),
      channelId: z.string().nullable().describe("Target voice channel, or null to disconnect."),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, userId, channelId, reason }) => {
    try {
      const g = await getGuild(guildId);
      const m = await g.members.fetch(userId);
      await m.voice.setChannel(channelId, reason);
      return ok({ userId, movedTo: channelId });
    } catch (e) { return err(e); }
  }
);

// ─── EMOJIS & STICKERS ──────────────────────────────────────────────────────

server.registerTool(
  "list_emojis",
  {
    title: "List custom emojis in a guild",
    description: "Return all custom emojis with names + IDs (use `<:name:id>` or `<a:name:id>` to render).",
    inputSchema: { guildId: z.string() },
  },
  async ({ guildId }) => {
    try {
      const g = await getGuild(guildId);
      await g.emojis.fetch();
      return ok([...g.emojis.cache.values()].map((e) => ({
        id: e.id, name: e.name, animated: e.animated, token: `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`,
      })));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "create_emoji",
  {
    title: "Upload a custom emoji",
    description: "Create a new custom emoji from a URL or local file path.",
    inputSchema: {
      guildId: z.string(),
      name: z.string(),
      imageUrlOrPath: z.string(),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, name, imageUrlOrPath, reason }) => {
    try {
      const g = await getGuild(guildId);
      const e = await g.emojis.create({ name, attachment: imageUrlOrPath, reason });
      return ok({ id: e.id, name: e.name, token: `<:${e.name}:${e.id}>` });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "delete_emoji",
  {
    title: "Delete a custom emoji",
    description: "Remove a custom emoji by ID.",
    inputSchema: { guildId: z.string(), emojiId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, emojiId, reason }) => {
    try {
      const g = await getGuild(guildId);
      await g.emojis.delete(emojiId, reason);
      return ok({ deleted: emojiId });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "list_stickers",
  {
    title: "List custom stickers in a guild",
    description: "Return all custom stickers with names + IDs.",
    inputSchema: { guildId: z.string() },
  },
  async ({ guildId }) => {
    try {
      const g = await getGuild(guildId);
      await g.stickers.fetch();
      return ok([...g.stickers.cache.values()].map((s) => ({
        id: s.id, name: s.name, description: s.description, tags: s.tags,
      })));
    } catch (e) { return err(e); }
  }
);

// ─── AUDIT LOG ──────────────────────────────────────────────────────────────

server.registerTool(
  "get_audit_log",
  {
    title: "Get guild audit log",
    description: "Recent moderation/admin actions. Optionally filter by action type or user.",
    inputSchema: {
      guildId: z.string(),
      limit: z.number().int().min(1).max(100).optional(),
      userId: z.string().optional(),
    },
  },
  async ({ guildId, limit, userId }) => {
    try {
      const g = await getGuild(guildId);
      const log = await g.fetchAuditLogs({ limit: limit ?? 50, user: userId });
      return ok([...log.entries.values()].map((e) => ({
        id: e.id,
        action: e.action,
        actionType: e.actionType,
        targetType: e.targetType,
        targetId: e.targetId,
        executorId: e.executorId,
        reason: e.reason,
        createdAt: e.createdAt?.toISOString(),
      })));
    } catch (e) { return err(e); }
  }
);

// ─── WEBHOOKS ───────────────────────────────────────────────────────────────

server.registerTool(
  "list_webhooks",
  {
    title: "List webhooks",
    description: "List webhooks in a channel (or whole guild if channelId omitted).",
    inputSchema: { guildId: z.string(), channelId: z.string().optional() },
  },
  async ({ guildId, channelId }) => {
    try {
      const g = await getGuild(guildId);
      const hooks = channelId
        ? await (await g.channels.fetch(channelId)).fetchWebhooks()
        : await g.fetchWebhooks();
      return ok([...hooks.values()].map((h) => ({
        id: h.id, name: h.name, channelId: h.channelId, token: h.token ? "[present]" : null,
      })));
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "create_webhook",
  {
    title: "Create a webhook",
    description: "Create a webhook on a channel.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      name: z.string(),
      avatarUrlOrPath: z.string().optional(),
      reason: z.string().optional(),
    },
  },
  async ({ guildId, channelId, name, avatarUrlOrPath, reason }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const h = await ch.createWebhook({ name, avatar: avatarUrlOrPath, reason });
      return ok({ id: h.id, name: h.name, url: h.url });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "delete_webhook",
  {
    title: "Delete a webhook",
    description: "Remove a webhook by ID.",
    inputSchema: { guildId: z.string(), webhookId: z.string(), reason: z.string().optional() },
  },
  async ({ guildId, webhookId, reason }) => {
    try {
      const g = await getGuild(guildId);
      const hooks = await g.fetchWebhooks();
      const h = hooks.get(webhookId);
      if (!h) throw new Error(`webhook ${webhookId} not found`);
      await h.delete(reason);
      return ok({ deleted: webhookId });
    } catch (e) { return err(e); }
  }
);

// ─── DIRECT MESSAGES ────────────────────────────────────────────────────────

server.registerTool(
  "send_dm",
  {
    title: "Send a direct message",
    description: "DM a user. Will silently fail if they have DMs from non-friends blocked.",
    inputSchema: { userId: z.string(), content: z.string() },
  },
  async ({ userId, content }) => {
    try {
      await ready;
      const user = await client.users.fetch(userId);
      const m = await user.send({ content });
      return ok({ messageId: m.id, channelId: m.channelId });
    } catch (e) { return err(e); }
  }
);

// ─── CROSS-GUILD DISCOVERY & SEARCH ─────────────────────────────────────────

server.registerTool(
  "list_all_guilds_detailed",
  {
    title: "List all guilds with detail",
    description:
      "Every guild the bot is in, with member count, channel count, owner, and the bot's own permissions there. Use this to get a bird's-eye view across the bot's presence.",
    inputSchema: {},
  },
  async () => {
    try {
      await ready;
      const guilds = await client.guilds.fetch();
      const out = [];
      for (const [, partial] of guilds) {
        try {
          const g = await partial.fetch();
          await g.channels.fetch();
          out.push({
            id: g.id,
            name: g.name,
            ownerId: g.ownerId,
            memberCount: g.memberCount,
            channelCount: g.channels.cache.size,
            iconUrl: g.iconURL() ?? null,
            botJoinedAt: g.members.me?.joinedAt?.toISOString() ?? null,
            botPermissions: g.members.me?.permissions.toArray() ?? [],
          });
        } catch (e) {
          out.push({ id: partial.id, name: partial.name, error: e.message });
        }
      }
      return ok(out);
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "find_channel",
  {
    title: "Find channels by name",
    description:
      "Case-insensitive substring search on channel names. Scope to one guild via guildId, or omit for all guilds the bot is in. Returns guild context for each match.",
    inputSchema: {
      query: z.string(),
      guildId: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
    },
  },
  async ({ query, guildId, limit }) => {
    try {
      await ready;
      const q = query.toLowerCase();
      const cap = limit ?? 50;
      const out = [];
      const guildList = guildId ? [await getGuild(guildId)] : await Promise.all(
        [...(await client.guilds.fetch()).values()].map((p) => p.fetch().catch(() => null)),
      );
      for (const g of guildList) {
        if (!g) continue;
        try { await g.channels.fetch(); } catch { /* skip */ }
        for (const [, c] of g.channels.cache) {
          if (c.name?.toLowerCase().includes(q)) {
            out.push({ guildId: g.id, guildName: g.name, ...channelSummary(c) });
            if (out.length >= cap) return ok(out);
          }
        }
      }
      return ok(out);
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "find_member",
  {
    title: "Find members by name",
    description:
      "Case-insensitive substring search on username, display name, and nickname. Scope to one guild via guildId, or omit for every guild the bot shares with people matching.",
    inputSchema: {
      query: z.string(),
      guildId: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
    },
  },
  async ({ query, guildId, limit }) => {
    try {
      await ready;
      const q = query.toLowerCase();
      const cap = limit ?? 50;
      const out = [];
      const guildList = guildId ? [await getGuild(guildId)] : await Promise.all(
        [...(await client.guilds.fetch()).values()].map((p) => p.fetch().catch(() => null)),
      );
      for (const g of guildList) {
        if (!g) continue;
        try { await g.members.fetch(); } catch { /* skip */ }
        for (const [, m] of g.members.cache) {
          const u = m.user.username?.toLowerCase() ?? "";
          const d = (m.displayName ?? "").toLowerCase();
          const n = (m.nickname ?? "").toLowerCase();
          const gn = (m.user.globalName ?? "").toLowerCase();
          if (u.includes(q) || d.includes(q) || n.includes(q) || gn.includes(q)) {
            out.push({ guildId: g.id, guildName: g.name, ...memberSummary(m), globalName: m.user.globalName ?? null });
            if (out.length >= cap) return ok(out);
          }
        }
      }
      return ok(out);
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "dump_members",
  {
    title: "Dump every member in every guild",
    description:
      "Brute-force fallback when find_member can't locate someone. Returns every cached member from every guild the bot is in, with id, username, globalName (Discord's new Display Name), guild nickname, guildId, guildName. Forces a full members.fetch() per guild first so cache is hot. Output can be large — pass guildId to scope to one server, or maxPerGuild to cap per guild.",
    inputSchema: {
      guildId: z.string().optional().describe("Limit to one guild."),
      maxPerGuild: z.number().int().min(1).max(2000).optional().describe("Cap members returned per guild. Default unlimited."),
    },
  },
  async ({ guildId, maxPerGuild }) => {
    try {
      await ready;
      const cap = maxPerGuild ?? Infinity;
      const out = [];
      const guildList = guildId ? [await getGuild(guildId)] : await Promise.all(
        [...(await client.guilds.fetch()).values()].map((p) => p.fetch().catch(() => null)),
      );
      for (const g of guildList) {
        if (!g) continue;
        try { await g.members.fetch(); } catch { /* skip */ }
        let count = 0;
        for (const [, m] of g.members.cache) {
          if (count >= cap) break;
          out.push({
            guildId: g.id,
            guildName: g.name,
            id: m.id,
            username: m.user.username,
            globalName: m.user.globalName ?? null,
            nickname: m.nickname ?? null,
            displayName: m.displayName,
            bot: m.user.bot,
          });
          count++;
        }
      }
      return ok({ totalGuilds: guildList.filter(Boolean).length, totalMembers: out.length, members: out });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "search_messages",
  {
    title: "Search recent messages by content",
    description:
      "Substring search (case-insensitive) over recent messages. Three scopes: (1) one channel via channelId, (2) all text channels in a guild via guildId, (3) every text channel across every guild if neither is set. Caps total scanned messages — broad searches sample recent history only, they don't do a full historical scan.",
    inputSchema: {
      query: z.string(),
      channelId: z.string().optional(),
      guildId: z.string().optional(),
      perChannelLimit: z.number().int().min(1).max(100).optional().describe("How many recent messages to scan per channel. Default 50."),
      maxHits: z.number().int().min(1).max(200).optional().describe("Stop after this many matches. Default 50."),
    },
  },
  async ({ query, channelId, guildId, perChannelLimit, maxHits }) => {
    try {
      await ready;
      const q = query.toLowerCase();
      const perCh = perChannelLimit ?? 50;
      const cap = maxHits ?? 50;
      const hits = [];

      const scanChannel = async (g, ch) => {
        if (!ch.isTextBased?.()) return;
        try {
          const msgs = await ch.messages.fetch({ limit: perCh });
          for (const [, m] of msgs) {
            if ((m.content ?? "").toLowerCase().includes(q)) {
              hits.push({
                guildId: g.id,
                guildName: g.name,
                channelId: ch.id,
                channelName: ch.name,
                ...messageSummary(m),
              });
              if (hits.length >= cap) return true;
            }
          }
        } catch { /* skip channels we can't read */ }
        return false;
      };

      if (channelId) {
        const g = await getGuild(guildId ?? (await (await client.channels.fetch(channelId)).guild.id));
        const ch = await g.channels.fetch(channelId);
        await scanChannel(g, ch);
      } else if (guildId) {
        const g = await getGuild(guildId);
        for (const [, ch] of g.channels.cache) {
          if (await scanChannel(g, ch)) break;
        }
      } else {
        const guilds = await client.guilds.fetch();
        outer: for (const [, partial] of guilds) {
          const g = await partial.fetch().catch(() => null);
          if (!g) continue;
          await g.channels.fetch().catch(() => {});
          for (const [, ch] of g.channels.cache) {
            if (await scanChannel(g, ch)) break outer;
          }
        }
      }

      return ok({ query, count: hits.length, hits });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "export_channel_messages",
  {
    title: "Export recent messages from a channel",
    description:
      "Dump up to 500 recent messages as a chronological list (oldest first). Useful for summarizing a channel, archiving a thread, or pulling context Kurumi can re-read.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      total: z.number().int().min(1).max(500).optional().describe("Default 200."),
      before: z.string().optional().describe("Message id — start exporting before this point."),
    },
  },
  async ({ guildId, channelId, total, before }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const want = total ?? 200;
      const collected = [];
      let cursor = before;
      while (collected.length < want) {
        const remaining = want - collected.length;
        const batch = await ch.messages.fetch({ limit: Math.min(100, remaining), before: cursor });
        if (!batch.size) break;
        for (const [, m] of batch) collected.push(m);
        cursor = batch.last().id;
        if (batch.size < 100) break;
      }
      collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      return ok({
        channelId,
        guildId,
        count: collected.length,
        messages: collected.map(messageSummary),
      });
    } catch (e) { return err(e); }
  }
);

// ─── CROSS-CHANNEL WRITING ──────────────────────────────────────────────────

server.registerTool(
  "broadcast_message",
  {
    title: "Send the same message to multiple channels",
    description:
      "Post identical content to a list of channels, possibly across different guilds. Returns per-target success/failure. Use sparingly — Discord considers this borderline spam if abused.",
    inputSchema: {
      content: z.string(),
      targets: z
        .array(
          z.object({
            guildId: z.string(),
            channelId: z.string(),
          })
        )
        .min(1)
        .max(20),
    },
  },
  async ({ content, targets }) => {
    const results = [];
    for (const t of targets) {
      try {
        const g = await getGuild(t.guildId);
        const ch = await g.channels.fetch(t.channelId);
        const m = await ch.send({ content });
        results.push({ ...t, ok: true, messageId: m.id });
      } catch (e) {
        results.push({ ...t, ok: false, error: e.message });
      }
    }
    return ok(results);
  }
);

server.registerTool(
  "crosspost_message",
  {
    title: "Copy a message to another channel",
    description:
      "Re-send a message from one channel to another, optionally with an attribution prefix like '[from #source by @author]'. Works across guilds. Does not actually move; original stays in place.",
    inputSchema: {
      sourceGuildId: z.string(),
      sourceChannelId: z.string(),
      sourceMessageId: z.string(),
      targetGuildId: z.string(),
      targetChannelId: z.string(),
      attribution: z.boolean().optional().describe("Prepend an attribution line. Default true."),
    },
  },
  async ({ sourceGuildId, sourceChannelId, sourceMessageId, targetGuildId, targetChannelId, attribution }) => {
    try {
      const sg = await getGuild(sourceGuildId);
      const sch = await sg.channels.fetch(sourceChannelId);
      const src = await sch.messages.fetch(sourceMessageId);
      const tg = await getGuild(targetGuildId);
      const tch = await tg.channels.fetch(targetChannelId);
      const prefix = (attribution ?? true)
        ? `*[from #${sch.name} in "${sg.name}" — ${src.author?.username ?? "unknown"}]*\n`
        : "";
      const sent = await tch.send({ content: `${prefix}${src.content || "*(empty original)*"}` });
      return ok({ messageId: sent.id, channelId: tch.id, guildId: tg.id });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "reply_to_message",
  {
    title: "Reply to a specific message",
    description: "Send a message as a Discord 'reply' (with the original quoted above) to a particular message id.",
    inputSchema: {
      guildId: z.string(),
      channelId: z.string(),
      messageId: z.string(),
      content: z.string(),
      mention: z.boolean().optional().describe("If false, the author isn't pinged by the reply. Default true."),
    },
  },
  async ({ guildId, channelId, messageId, content, mention }) => {
    try {
      const g = await getGuild(guildId);
      const ch = await g.channels.fetch(channelId);
      const src = await ch.messages.fetch(messageId);
      const sent = await src.reply({
        content,
        allowedMentions: { repliedUser: mention ?? true },
      });
      return ok({ messageId: sent.id, channelId: ch.id });
    } catch (e) { return err(e); }
  }
);

// ─── USER LOOKUP & DMS ──────────────────────────────────────────────────────

server.registerTool(
  "get_user_info",
  {
    title: "Look up a Discord user globally",
    description:
      "Fetch basic info for any Discord user by id — does not require sharing a guild. Returns username, display name, avatar URL, bot flag, account created date.",
    inputSchema: { userId: z.string() },
  },
  async ({ userId }) => {
    try {
      await ready;
      const u = await client.users.fetch(userId);
      return ok({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        bot: u.bot,
        avatarUrl: u.displayAvatarURL({ size: 256 }),
        createdAt: u.createdAt.toISOString(),
      });
    } catch (e) { return err(e); }
  }
);

server.registerTool(
  "fetch_dm_history",
  {
    title: "Read DM history with a user",
    description:
      "Fetch recent DM messages between the bot and a specific user. Returns up to 100 messages.",
    inputSchema: {
      userId: z.string(),
      limit: z.number().int().min(1).max(100).optional().describe("Default 50."),
      before: z.string().optional(),
    },
  },
  async ({ userId, limit, before }) => {
    try {
      await ready;
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      const msgs = await dm.messages.fetch({ limit: limit ?? 50, before });
      return ok([...msgs.values()].map(messageSummary));
    } catch (e) { return err(e); }
  }
);

// ─── ───────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("discord-server-bot MCP server connected on stdio.");

const shutdown = async () => { try { await client.destroy(); } catch {} process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
