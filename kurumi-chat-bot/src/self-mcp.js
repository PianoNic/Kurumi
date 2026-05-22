#!/usr/bin/env node
// Tiny MCP server that exposes Kurumi's own runtime config so she can rewrite
// her own behavior on owner request. JSON document at $KURUMI_CONFIG_FILE
// (default /state/kurumi-config.json). The chat bot reloads this file on
// every message, so changes take effect immediately — no restart.
//
// Attached only when the requester is the OWNER. Founders and regular users
// never see these tools.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const CONFIG_FILE = resolve(process.env.KURUMI_CONFIG_FILE ?? "/state/kurumi-config.json");
const NOTES_FILE = resolve(process.env.KURUMI_NOTES_FILE ?? "/state/kurumi-notes.json");
const GIF_INDEX_FILE = resolve(process.env.KURUMI_GIF_INDEX ?? "/state/gif-library/index.json");
const GIF_LIBRARY_DIR = resolve(process.env.KURUMI_GIF_LIBRARY ?? "/state/gif-library");
const LOOSE_TOOLS_DIR = resolve(process.env.KURUMI_LOOSE_TOOLS ?? "/kurumi-tools/loose");
const LOOSE_TOOLS_INDEX = resolve(LOOSE_TOOLS_DIR, "index.json");
const LOOSE_TOOL_NAME_RE = /^[a-z][a-z0-9_-]{0,40}$/i;
const SLASH_COMMANDS_FILE = resolve(process.env.KURUMI_SLASH_COMMANDS_FILE ?? "/state/slash-commands.json");
const SLASH_NAME_RE = /^[\w-]{1,32}$/;
// Discord application command option types we support. Strings, integers,
// booleans, users, channels, roles cover ~everything a casual command needs.
const SLASH_OPTION_TYPES = { string: 3, integer: 4, boolean: 5, user: 6, channel: 7, role: 8, number: 10 };

// Tier set per-spawn by the bot via the MCP server's env block:
//   "admin" — owner. Everything: read + write config, mute users, reset, etc.
//   "self"  — founders. Operational tools only: mute channels, manage
//             auto-respond patterns, manage notes, READ config. Cannot
//             change global model/persona/presence or mute users.
const TIER = process.env.KURUMI_MCP_TIER === "self" ? "self" : "admin";
const SELF_TOOL_NAMES = new Set([
  "config_list_keys",
  "config_get",
  "note_add",
  "note_list",
  "note_promote",
  "note_search",
  "note_remove",
  "mute_channel",
  "unmute_channel",
  "auto_respond_add",
  "auto_respond_remove",
  "gif_save",
  "gif_save_from_url",
  "gif_list",
  "gif_search",
  "gif_remove",
  "loose_tool_create",
  "loose_tool_list",
  "loose_tool_run",
  "loose_tool_remove",
  "slash_command_register",
  "slash_command_list",
  "slash_command_unregister",
]);

// Scope shape: "global" | "guild:<id>" | "channel:<id>" | "user:<id>".
const SCOPE_RE = /^(global|guild:\d+|channel:\d+|user:\d+)$/;

// Three-tier memory model.
//   short   — fresh observations; auto-injected; auto-demoted to archive when
//             count per (scope) exceeds SHORT_CAP_PER_SCOPE.
//   long    — curated facts; auto-injected; never auto-demoted (only promoted
//             explicitly by Kurumi).
//   archive — cold storage; NOT auto-injected; searchable via note_search.
const TIERS = ["short", "long", "archive"];
const SHORT_CAP_PER_SCOPE = 15;

function loadNotes() {
  if (!existsSync(NOTES_FILE)) return [];
  try {
    const arr = JSON.parse(readFileSync(NOTES_FILE, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveNotes(notes) {
  mkdirSync(dirname(NOTES_FILE), { recursive: true });
  writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

function loadGifIndex() {
  if (!existsSync(GIF_INDEX_FILE)) return [];
  try {
    const arr = JSON.parse(readFileSync(GIF_INDEX_FILE, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveGifIndex(index) {
  mkdirSync(GIF_LIBRARY_DIR, { recursive: true });
  writeFileSync(GIF_INDEX_FILE, JSON.stringify(index, null, 2));
}

function loadLooseTools() {
  if (!existsSync(LOOSE_TOOLS_INDEX)) return [];
  try {
    const arr = JSON.parse(readFileSync(LOOSE_TOOLS_INDEX, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveLooseTools(tools) {
  mkdirSync(LOOSE_TOOLS_DIR, { recursive: true });
  writeFileSync(LOOSE_TOOLS_INDEX, JSON.stringify(tools, null, 2));
}

function loadSlashCommands() {
  if (!existsSync(SLASH_COMMANDS_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(SLASH_COMMANDS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function saveSlashCommands(map) {
  mkdirSync(dirname(SLASH_COMMANDS_FILE), { recursive: true });
  writeFileSync(SLASH_COMMANDS_FILE, JSON.stringify(map, null, 2));
}

async function discordApi(path, method, body) {
  const token = process.env.KURUMI_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.KURUMI_APPLICATION_ID || process.env.DISCORD_APPLICATION_ID;
  if (!token) throw new Error("KURUMI_BOT_TOKEN not set in MCP env");
  if (!appId) throw new Error("KURUMI_APPLICATION_ID not set in MCP env — owner needs to add it to compose.yml");
  const url = `https://discord.com/api/v10/applications/${appId}${path}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bot ${token}`, "content-type": "application/json", "user-agent": "Kurumi (kurumi-self, 0.2.0)" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord ${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// Settable keys with their schemas and human descriptions. Any key not in
// here is rejected by config_set. Free-form values are validated per-key;
// bad inputs come back as a tool error.
const SCHEMA = {
  model: {
    type: z.string().min(1).max(120),
    description:
      "Model name used for every reply. Default: claude-haiku-4-5. When anthropicBaseUrl is set, this can be ANY model name your endpoint accepts (e.g. 'glm-4.6', 'deepseek-chat', 'gpt-4o-mini' via a compat shim). Anthropic policy: sonnet/opus forbidden — stick to haiku unless using a non-Anthropic endpoint.",
  },
  effort: {
    type: z.enum(["low", "medium", "high", "xhigh", "max"]),
    description:
      "Reasoning effort for each reply. low = fast and shallow, medium = default, high/xhigh/max = more thinking time, slower and more expensive.",
  },
  timeoutMs: {
    type: z.number().int().min(10_000).max(15 * 60 * 1000),
    description:
      "How long (ms) Kurumi waits for a single reply to finish before killing the subprocess. 10000–900000.",
  },
  founderRole: {
    type: z.string().min(1).max(50),
    description:
      "Substring (case-insensitive) matched against Discord role names to identify founders in a guild.",
  },
  autoRespondPatterns: {
    type: z
      .array(z.string().min(1).max(80))
      .max(50),
    description:
      "List of substrings (case-insensitive). If any pattern is found in a channel's name OR its parent category's name, Kurumi auto-replies to every message there without needing an @mention. Empty list = mention-only everywhere. Use auto_respond_add / auto_respond_remove for ergonomic edits.",
  },
  personaAddendum: {
    type: z.string().max(2000),
    description:
      "Extra text appended to Kurumi's system prompt. Use to nudge tone, add facts about the server, request bilingual replies, etc. Be careful — this is raw prompt territory, anything here overrides nothing but layers on top.",
  },
  presenceStatus: {
    type: z.enum(["online", "idle", "dnd", "invisible"]),
    description:
      "Discord presence indicator (the colored dot on the avatar). online = green, idle = yellow, dnd = red, invisible = appears offline.",
  },
  presenceActivityType: {
    type: z.enum(["Playing", "Watching", "Listening", "Competing", "Custom"]),
    description:
      "Activity verb shown next to Kurumi's name (e.g. 'Watching the clock tick'). Custom shows only the raw text with no verb.",
  },
  presenceActivityText: {
    type: z.string().min(0).max(128),
    description:
      "Activity text. Combined with presenceActivityType it produces e.g. 'Watching the clock tick' or, with Custom, just 'the clock tick'.",
  },
  mutedChannels: {
    type: z.array(z.string().regex(/^\d+$/)).max(500),
    description:
      "Channel IDs Kurumi will completely ignore — no replies even on @mention. Owner messages bypass this (so the owner can always unmute). Use mute_channel / unmute_channel for ergonomic edits.",
  },
  mutedUsers: {
    type: z.array(z.string().regex(/^\d+$/)).max(500),
    description:
      "User IDs Kurumi will completely ignore, anywhere. Owner cannot be muted. Use mute_user / unmute_user for ergonomic edits.",
  },
  cooldownSecondsPerChannel: {
    type: z.number().int().min(0).max(3600),
    description:
      "Minimum seconds between Kurumi's own replies in a single channel. Prevents her from spamming when conversation is fast. 0 = disabled. @mentions and owner messages bypass cooldown.",
  },
  autoRespondMinChars: {
    type: z.number().int().min(0).max(2000),
    description:
      "In auto-respond zones (channels/categories matched by autoRespondPatterns), Kurumi only engages on messages of at least this many characters. Filters out drive-by 'lol' / 'xD' / single emojis.",
  },
  autoRespondChance: {
    type: z.number().min(0).max(1),
    description:
      "Probability (0.0–1.0) of replying to a non-@mention message in an auto-respond zone. 1.0 = always, 0.3 = roughly every third message. Lets Kurumi feel present without monologuing.",
  },
  maxReplyChars: {
    type: z.number().int().min(200).max(4000),
    description:
      "Max characters in any single Discord message Kurumi sends. Replies longer than this are split into multiple messages.",
  },
  ignoreOtherBots: {
    type: z.boolean(),
    description:
      "If true (default), Kurumi never replies to other bots. Set false to allow bot-to-bot dialogue (rare; usually a footgun).",
  },
  casualMessageGating: {
    type: z.boolean(),
    description:
      "When true (default), in auto-respond zones Kurumi runs a cheap secondary inference (model: casualMessageGatingModel) to decide whether each casual message is worth replying to. Lets her sit quietly through inter-user banter and only jump in when she'd actually add value. Disable to make her reply to every qualifying message in auto-respond zones.",
  },
  casualMessageGatingModel: {
    type: z.string().min(1).max(120),
    description:
      "Model used for the should-I-respond decision in auto-respond zones. Defaults to haiku (cheap and fast). Switch to sonnet if she's making bad judgement calls.",
  },
  anthropicBaseUrl: {
    type: z.union([z.string().url(), z.null()]),
    description:
      "Custom Anthropic-compatible API base URL. Set this to point claude-code at a non-Anthropic backend: Z.AI / GLM ('https://api.z.ai/api/anthropic'), OpenRouter via anthropic shim, LiteLLM proxy, local vLLM with anthropic-translate, etc. Leave null to use Anthropic's official API. Restart the bot or wait for the next message — change picks up on the next spawn.",
  },
  anthropicAuthToken: {
    type: z.union([z.string().min(1), z.null()]),
    description:
      "Auth token for the custom endpoint above. Sent as ANTHROPIC_AUTH_TOKEN when anthropicBaseUrl is set, otherwise treated as ANTHROPIC_API_KEY fallback. Stored in /state/kurumi-config.json — keep that volume out of any repo.",
  },
  smallFastModel: {
    type: z.union([z.string().min(1).max(120), z.null()]),
    description:
      "Optional ANTHROPIC_SMALL_FAST_MODEL override for claude-code's internal cheap-model slot (compaction, edits, etc.). Useful with custom endpoints that don't ship haiku.",
  },
};

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {
    return { __error__: `failed to parse ${CONFIG_FILE}: ${e.message}` };
  }
}

function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

const server = new Server(
  { name: "kurumi-self", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

const ALL_TOOLS = [
    {
      name: "config_list_keys",
      description:
        "List every key Kurumi can self-modify, with description, type, and current value. Call this first if unsure.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "config_get",
      description: "Get the current value of one key.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
        additionalProperties: false,
      },
    },
    {
      name: "config_set",
      description:
        "Set one key. Validated against the schema; rejected on unknown key or wrong type. Takes effect on next message.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { description: "Type depends on the key (see config_list_keys)." },
        },
        required: ["key", "value"],
        additionalProperties: false,
      },
    },
    {
      name: "config_reset",
      description: "Clear one key so the env default takes back over.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
        additionalProperties: false,
      },
    },
    {
      name: "note_add",
      description:
        "Write a note to memory. Tier defaults to 'short' (fresh observation, auto-rotated). Promote to 'long' for facts worth keeping forever. Scope: 'global' | 'guild:<id>' | 'channel:<id>' | 'user:<id>'. Short and long notes auto-inject into every relevant prompt; archive notes don't. Returns the assigned id.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string", description: "global | guild:<id> | channel:<id> | user:<id>" },
          text: { type: "string", description: "One fact. Short." },
          tier: { type: "string", enum: TIERS, description: "short (default) | long | archive" },
        },
        required: ["scope", "text"],
        additionalProperties: false,
      },
    },
    {
      name: "note_list",
      description:
        "List notes. Filter by scope (exact), tier (exact), or text substring. With no filters, returns everything except archive. Pass tier='archive' or includeArchive=true to see archived notes.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string" },
          contains: { type: "string" },
          tier: { type: "string", enum: TIERS },
          includeArchive: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "note_promote",
      description:
        "Move a note between tiers. Common flow: short → long (curate something worth keeping), long → archive (retire a fact that no longer matters), archive → long (resurrect).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          tier: { type: "string", enum: TIERS },
        },
        required: ["id", "tier"],
        additionalProperties: false,
      },
    },
    {
      name: "note_search",
      description:
        "Full-text search across notes (including archive). Use this to recall something you can't find in injected context — e.g. 'what did pianonic say about X months ago'.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "note_remove",
      description: "Delete a note permanently by id. Prefer note_promote to 'archive' over deletion.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "mute_channel",
      description:
        "Stop responding in a channel entirely (including @mentions). Use this when a user says 'stop talking here', 'don't post in this channel', 'be quiet in #foo', etc. Owner messages bypass mutes, so this is safe — the owner can always unmute.",
      inputSchema: {
        type: "object",
        properties: { channelId: { type: "string", description: "Numeric Discord channel id." } },
        required: ["channelId"],
        additionalProperties: false,
      },
    },
    {
      name: "unmute_channel",
      description: "Reverse mute_channel — resume responding in this channel.",
      inputSchema: {
        type: "object",
        properties: { channelId: { type: "string" } },
        required: ["channelId"],
        additionalProperties: false,
      },
    },
    {
      name: "mute_user",
      description:
        "Ignore this user everywhere. Use sparingly — only for confirmed bad actors, not annoying ones. Owner cannot be muted.",
      inputSchema: {
        type: "object",
        properties: { userId: { type: "string", description: "Numeric Discord user id." } },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    {
      name: "unmute_user",
      description: "Reverse mute_user — resume responding to this user.",
      inputSchema: {
        type: "object",
        properties: { userId: { type: "string" } },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    {
      name: "auto_respond_add",
      description:
        "Convenience: add a single substring to autoRespondPatterns. Idempotent — duplicates are ignored.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Substring matched (case-insensitive) against channel and parent-category names.",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
    {
      name: "auto_respond_remove",
      description: "Convenience: remove a single substring from autoRespondPatterns.",
      inputSchema: {
        type: "object",
        properties: { pattern: { type: "string" } },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
    {
      name: "gif_save",
      description:
        "Add a GIF (or any image attachment) you've seen to your persistent GIF library so you can reuse it later like a sticker via the {{gif:<id>}} macro. Pass the local path of an attachment from your /state/attachments folder (the context block lists them), plus a short description and a few tags. Inspect the file with Read first if you haven't already — saving without looking is wasteful. Returns the new gif id.",
      inputSchema: {
        type: "object",
        properties: {
          sourcePath: {
            type: "string",
            description: "Absolute path to the source image, typically /state/attachments/<...>.",
          },
          name: {
            type: "string",
            description: "Short slug-friendly name. Examples: 'kurumi-wink', 'cat-typing', 'sad-anime-girl'.",
          },
          description: {
            type: "string",
            description: "One-sentence description of what the GIF shows and the emotional beat. Used by future-you to decide when to send it.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "3–8 short tags. Examples: ['reaction','approval','smug'], ['celebration','joy'], ['confused','idk'].",
          },
        },
        required: ["sourcePath", "name", "description", "tags"],
        additionalProperties: false,
      },
    },
    {
      name: "gif_save_from_url",
      description:
        "Save a GIF from a URL. Accepts direct media URLs (.gif/.mp4/.webp/.png/.jpg from media.discordapp.net, cdn.discord, tenor.com/media, c.tenor.com, media.tenor.com, media.giphy.com, etc.) AND Tenor/Giphy view pages (tenor.com/view/..., giphy.com/gifs/...) — for view pages, the tool scrapes the og:image / og:video meta tag and downloads the underlying media automatically. Use this when someone links a GIF instead of attaching a file. Inspect the source URL or a downloaded preview first if you're unsure it's the right one.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Direct media URL or Tenor/Giphy view page URL." },
          name: { type: "string", description: "Short slug-friendly name." },
          description: { type: "string", description: "One-sentence description of what it shows + the vibe." },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "3–8 short tags. Examples: ['reaction','smug'], ['celebration','joy'].",
          },
        },
        required: ["url", "name", "description", "tags"],
        additionalProperties: false,
      },
    },
    {
      name: "gif_list",
      description:
        "List every saved GIF in your library with its id, name, description, tags, and path. Use this to remember what you have.",
      inputSchema: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Optional: filter to GIFs that have this tag." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "gif_search",
      description:
        "Search saved GIFs by substring against name, description, or any tag. Use this when you want to find a fitting GIF for the current moment.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "gif_remove",
      description: "Permanently delete a saved GIF (file + index entry) by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "loose_tool_create",
      description:
        "Author a NEW loose tool on the fly: a small executable script stored in /kurumi-tools/loose/<name>.<ext> with metadata in /kurumi-tools/loose/index.json. Once registered, invoke it via loose_tool_run — no container restart, no MCP refresh needed. Use this when you want to extend yourself: a one-off scraper, a recurring API caller, a custom formatter, a wrapper around an existing CLI. The script gets the tool args as a single JSON string on argv[2] (interpreter-agnostic). Stdout becomes the tool result; non-zero exit becomes an error. **DO NOT** use this to bypass scope discipline — no installing system packages, no downloading binaries, no calling Discord REST directly with the bot token.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tool name, [a-z][a-z0-9_-]{0,40}. Lowercase, slug style. Examples: 'fetch-joke', 'count-emojis', 'whois-tld'.",
          },
          description: {
            type: "string",
            description: "One-sentence description of what the tool does and when to use it. Future-you will read this to decide whether to call the tool.",
          },
          interpreter: {
            type: "string",
            enum: ["bash", "node"],
            description: "How to invoke the script: 'bash' (script saved as .sh) or 'node' (script saved as .js).",
          },
          code: {
            type: "string",
            description: "The complete script source. For 'bash', the first line is auto-set to '#!/bin/bash\\nset -e'. For 'node', it's '#!/usr/bin/env node'. The tool's JSON args arrive as argv[2] / process.argv[2] — parse with `jq -r '.foo' <<< \"$1\"` (bash) or `JSON.parse(process.argv[2] || '{}')` (node).",
          },
          argsHint: {
            type: "string",
            description: "Free-form hint to future-you about what JSON shape to pass as args. Examples: '{topic: string}' or '{count?: number, format?: \"json\"|\"text\"}'.",
          },
        },
        required: ["name", "description", "interpreter", "code"],
        additionalProperties: false,
      },
    },
    {
      name: "loose_tool_list",
      description: "List every registered loose tool with name, description, interpreter, path, and argsHint. Read this before authoring new ones to avoid duplicates.",
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "loose_tool_run",
      description:
        "Execute a registered loose tool by name with optional JSON args. Returns the script's stdout (capped at 16 KB) on success, the stderr + exit code on failure. 30-second hard timeout per invocation. Use this to call any tool you previously registered via loose_tool_create — and only those tools (it cannot run arbitrary paths).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Registered loose tool name." },
          args: {
            description: "Optional JSON-serializable args, passed to the script as argv[2] (a single JSON-encoded string).",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "loose_tool_remove",
      description: "Permanently delete a loose tool (script file + index entry) by name.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "slash_command_register",
      description:
        "Register a Discord slash command at runtime that dispatches to a loose tool. **No bot restart needed.** Guild-scoped commands appear instantly; global ones take up to 1 hour to propagate to all of Discord. The command's option values are passed to the loose tool as JSON args (e.g. `/roast target:@nic intensity:high` → `{target: '<userId>', intensity: 'high'}`). The bot also injects `__invokedBy`, `__invokedByTag`, `__channelId`, `__guildId` so the script knows who called it where. Loose tool's stdout (first 1900 chars) becomes the reply.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Slash command name. 1–32 chars, [a-z0-9_-]. No spaces, no uppercase." },
          description: { type: "string", description: "1–100 char description shown in Discord's UI." },
          looseToolName: { type: "string", description: "Name of an existing loose tool (must be created first with loose_tool_create) that will be executed when this command is invoked." },
          guildId: { type: "string", description: "If set, command is registered only in this guild (instant). Omit for global registration (slower propagation, but visible everywhere)." },
          options: {
            type: "array",
            description: "Optional slash command parameters. Each: {name, description, type, required?}. type ∈ string|integer|number|boolean|user|channel|role.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                type: { type: "string", enum: ["string", "integer", "number", "boolean", "user", "channel", "role"] },
                required: { type: "boolean" },
              },
              required: ["name", "description", "type"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "description", "looseToolName"],
        additionalProperties: false,
      },
    },
    {
      name: "slash_command_list",
      description: "List every slash command Kurumi has registered, with their loose-tool mapping, guild scope, and Discord-side command id.",
      inputSchema: { type: "object", additionalProperties: false },
    },
    {
      name: "slash_command_unregister",
      description: "Remove a slash command from Discord and from the dispatch map. Pass the command name; guildId is required only if it was registered guild-scoped.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          guildId: { type: "string", description: "Required when removing a guild-scoped command, omit for global." },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TIER === "admin" ? ALL_TOOLS : ALL_TOOLS.filter((t) => SELF_TOOL_NAMES.has(t.name)),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (TIER === "self" && !SELF_TOOL_NAMES.has(name)) {
    return {
      content: [{ type: "text", text: `tool "${name}" requires OWNER tier; founder tier cannot invoke it` }],
      isError: true,
    };
  }
  const cfg = loadConfig();

  if (name === "config_list_keys") {
    const out = Object.entries(SCHEMA).map(([key, def]) => ({
      key,
      description: def.description,
      currentValue: cfg[key] ?? null,
    }));
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }

  if (name === "config_get") {
    const key = String(args?.key ?? "");
    if (!(key in SCHEMA)) {
      return { content: [{ type: "text", text: `unknown key: ${key}` }], isError: true };
    }
    return {
      content: [
        { type: "text", text: JSON.stringify({ key, value: cfg[key] ?? null }, null, 2) },
      ],
    };
  }

  if (name === "config_set") {
    const key = String(args?.key ?? "");
    const def = SCHEMA[key];
    if (!def) {
      return { content: [{ type: "text", text: `unknown key: ${key}` }], isError: true };
    }
    const parsed = def.type.safeParse(args?.value);
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text",
            text: `invalid value for ${key}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
          },
        ],
        isError: true,
      };
    }
    cfg[key] = parsed.data;
    saveConfig(cfg);
    return { content: [{ type: "text", text: `ok — ${key} = ${JSON.stringify(parsed.data)}` }] };
  }

  if (name === "config_reset") {
    const key = String(args?.key ?? "");
    if (!(key in SCHEMA)) {
      return { content: [{ type: "text", text: `unknown key: ${key}` }], isError: true };
    }
    delete cfg[key];
    saveConfig(cfg);
    return { content: [{ type: "text", text: `ok — cleared ${key}, env default restored` }] };
  }

  if (name === "note_add") {
    const scope = String(args?.scope ?? "");
    const text = String(args?.text ?? "").trim();
    const tier = TIERS.includes(args?.tier) ? args.tier : "short";
    if (!SCOPE_RE.test(scope)) {
      return { content: [{ type: "text", text: `invalid scope "${scope}". Use global | guild:<id> | channel:<id> | user:<id>` }], isError: true };
    }
    if (!text) {
      return { content: [{ type: "text", text: "text is required" }], isError: true };
    }
    const notes = loadNotes();
    const id = `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    notes.push({ id, scope, text, tier, createdAt: new Date().toISOString() });

    // Auto-rotate: if this scope now has too many short-term notes, demote
    // the oldest ones to archive. Keeps the context block from bloating.
    let demoted = 0;
    if (tier === "short") {
      const shortInScope = notes
        .filter((n) => n.scope === scope && n.tier === "short")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      while (shortInScope.length > SHORT_CAP_PER_SCOPE) {
        const oldest = shortInScope.shift();
        oldest.tier = "archive";
        demoted++;
      }
    }

    saveNotes(notes);
    return {
      content: [
        { type: "text", text: `ok — saved as ${id} (tier: ${tier})${demoted ? `, auto-archived ${demoted} oldest short-term note(s) in scope` : ""}` },
      ],
    };
  }

  if (name === "note_list") {
    const scope = args?.scope ? String(args.scope) : null;
    const contains = args?.contains ? String(args.contains).toLowerCase() : null;
    const tier = TIERS.includes(args?.tier) ? args.tier : null;
    const includeArchive = !!args?.includeArchive;
    const notes = loadNotes().filter((n) => {
      if (scope && n.scope !== scope) return false;
      if (contains && !n.text.toLowerCase().includes(contains)) return false;
      if (tier) return n.tier === tier;
      if (!includeArchive && n.tier === "archive") return false;
      return true;
    });
    return { content: [{ type: "text", text: JSON.stringify(notes, null, 2) }] };
  }

  if (name === "note_promote") {
    const id = String(args?.id ?? "");
    const tier = TIERS.includes(args?.tier) ? args.tier : null;
    if (!tier) {
      return { content: [{ type: "text", text: `tier must be one of ${TIERS.join(", ")}` }], isError: true };
    }
    const notes = loadNotes();
    const note = notes.find((n) => n.id === id);
    if (!note) {
      return { content: [{ type: "text", text: `no note with id ${id}` }], isError: true };
    }
    const prev = note.tier;
    note.tier = tier;
    saveNotes(notes);
    return { content: [{ type: "text", text: `ok — ${id}: ${prev} → ${tier}` }] };
  }

  if (name === "note_search") {
    const query = String(args?.query ?? "").toLowerCase().trim();
    if (!query) {
      return { content: [{ type: "text", text: "query is required" }], isError: true };
    }
    const hits = loadNotes().filter((n) => n.text.toLowerCase().includes(query));
    return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
  }

  if (name === "note_remove") {
    const id = String(args?.id ?? "");
    const before = loadNotes();
    const after = before.filter((n) => n.id !== id);
    saveNotes(after);
    return {
      content: [{ type: "text", text: before.length === after.length ? `no note with id ${id}` : `ok — removed ${id}` }],
    };
  }

  const setListAdd = (key, value, regex) => {
    const v = String(value ?? "").trim();
    if (!regex.test(v)) {
      return { content: [{ type: "text", text: `invalid id: ${v}` }], isError: true };
    }
    const list = Array.isArray(cfg[key]) ? cfg[key] : [];
    if (!list.includes(v)) list.push(v);
    cfg[key] = list;
    saveConfig(cfg);
    return { content: [{ type: "text", text: `ok — ${key} now has ${list.length} entr${list.length === 1 ? "y" : "ies"}` }] };
  };
  const setListRemove = (key, value) => {
    const v = String(value ?? "").trim();
    const list = (Array.isArray(cfg[key]) ? cfg[key] : []).filter((x) => x !== v);
    cfg[key] = list;
    saveConfig(cfg);
    return { content: [{ type: "text", text: `ok — ${key} now has ${list.length} entr${list.length === 1 ? "y" : "ies"}` }] };
  };

  if (name === "mute_channel")   return setListAdd("mutedChannels", args?.channelId, /^\d+$/);
  if (name === "unmute_channel") return setListRemove("mutedChannels", args?.channelId);
  if (name === "mute_user")      return setListAdd("mutedUsers", args?.userId, /^\d+$/);
  if (name === "unmute_user")    return setListRemove("mutedUsers", args?.userId);

  if (name === "gif_save") {
    const sourcePath = String(args?.sourcePath ?? "");
    const niceName = String(args?.name ?? "").trim().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 60);
    const description = String(args?.description ?? "").trim();
    const tags = Array.isArray(args?.tags) ? args.tags.map(String).map((t) => t.trim().toLowerCase()).filter(Boolean) : [];
    if (!sourcePath || !existsSync(sourcePath)) {
      return { content: [{ type: "text", text: `sourcePath does not exist: ${sourcePath}` }], isError: true };
    }
    if (!niceName || !description || tags.length === 0) {
      return { content: [{ type: "text", text: "name, description, and at least one tag are required" }], isError: true };
    }
    const ext = (sourcePath.match(/\.[a-z0-9]+$/i)?.[0] ?? ".gif").toLowerCase();
    const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    mkdirSync(GIF_LIBRARY_DIR, { recursive: true });
    const destPath = resolve(GIF_LIBRARY_DIR, `${id}-${niceName}${ext}`);
    try { copyFileSync(sourcePath, destPath); }
    catch (e) { return { content: [{ type: "text", text: `copy failed: ${e.message}` }], isError: true }; }
    const index = loadGifIndex();
    index.push({
      id, name: niceName, description, tags,
      path: destPath, ext, addedAt: new Date().toISOString(),
    });
    saveGifIndex(index);
    return { content: [{ type: "text", text: `ok — saved as ${id} at ${destPath}` }] };
  }

  if (name === "gif_save_from_url") {
    const url = String(args?.url ?? "").trim();
    const niceName = String(args?.name ?? "").trim().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 60);
    const description = String(args?.description ?? "").trim();
    const tags = Array.isArray(args?.tags)
      ? args.tags.map(String).map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];
    if (!/^https?:\/\//i.test(url)) {
      return { content: [{ type: "text", text: "url must start with http(s)://" }], isError: true };
    }
    if (!niceName || !description || tags.length === 0) {
      return { content: [{ type: "text", text: "name, description, and at least one tag are required" }], isError: true };
    }

    // Resolve view-page URLs (tenor.com/view/..., giphy.com/gifs/...) to the
    // underlying media URL by scraping og:image / og:video meta tags. Direct
    // media URLs pass through unchanged.
    let mediaUrl = url;
    const isViewPage =
      /tenor\.com\/view\//i.test(url) ||
      /giphy\.com\/gifs\//i.test(url) ||
      (!/\.(gif|mp4|webp|webm|png|jpe?g)(\?|$)/i.test(url) && /tenor\.com|giphy\.com/i.test(url));
    if (isViewPage) {
      try {
        const html = await (await fetch(url, {
          headers: { "user-agent": "Mozilla/5.0 KurumiBot" },
          redirect: "follow",
        })).text();
        const ogVideo = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i)?.[1];
        const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
        // Prefer gif/mp4 — prefer image (usually .gif) for Tenor since Discord
        // renders it inline as an animation; fall back to og:video (mp4).
        mediaUrl = ogImage || ogVideo || url;
      } catch (e) {
        return { content: [{ type: "text", text: `failed to scrape ${url}: ${e.message}` }], isError: true };
      }
    }

    let buf;
    let contentType = "";
    try {
      const res = await fetch(mediaUrl, {
        headers: { "user-agent": "Mozilla/5.0 KurumiBot", referer: url },
        redirect: "follow",
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `download failed: HTTP ${res.status} for ${mediaUrl}` }], isError: true };
      }
      contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      return { content: [{ type: "text", text: `download failed: ${e.message}` }], isError: true };
    }

    let ext =
      (mediaUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? "").toLowerCase() ||
      (contentType.includes("gif") ? "gif"
        : contentType.includes("mp4") ? "mp4"
        : contentType.includes("webp") ? "webp"
        : contentType.includes("png") ? "png"
        : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
        : "bin");
    if (!/^(gif|mp4|webp|webm|png|jpe?g)$/i.test(ext)) ext = "gif";

    const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    mkdirSync(GIF_LIBRARY_DIR, { recursive: true });
    const destPath = resolve(GIF_LIBRARY_DIR, `${id}-${niceName}.${ext}`);
    try { writeFileSync(destPath, buf); }
    catch (e) { return { content: [{ type: "text", text: `write failed: ${e.message}` }], isError: true }; }

    const index = loadGifIndex();
    index.push({
      id, name: niceName, description, tags,
      path: destPath, ext: `.${ext}`,
      sourceUrl: url, resolvedUrl: mediaUrl,
      bytes: buf.length, contentType,
      addedAt: new Date().toISOString(),
    });
    saveGifIndex(index);
    return {
      content: [{
        type: "text",
        text: `ok — saved as ${id} (${buf.length} bytes, ${contentType || ext}) at ${destPath}`,
      }],
    };
  }

  if (name === "gif_list") {
    const tag = args?.tag ? String(args.tag).toLowerCase() : null;
    const gifs = loadGifIndex().filter((g) => !tag || g.tags?.includes(tag));
    return { content: [{ type: "text", text: JSON.stringify(gifs, null, 2) }] };
  }

  if (name === "gif_search") {
    const q = String(args?.query ?? "").toLowerCase().trim();
    if (!q) return { content: [{ type: "text", text: "query is required" }], isError: true };
    const hits = loadGifIndex().filter(
      (g) =>
        g.name?.toLowerCase().includes(q) ||
        g.description?.toLowerCase().includes(q) ||
        g.tags?.some((t) => t.includes(q)),
    );
    return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
  }

  if (name === "gif_remove") {
    const id = String(args?.id ?? "");
    const before = loadGifIndex();
    const entry = before.find((g) => g.id === id);
    if (!entry) return { content: [{ type: "text", text: `no gif with id ${id}` }], isError: true };
    try { rmSync(entry.path, { force: true }); } catch { /* ignore */ }
    saveGifIndex(before.filter((g) => g.id !== id));
    return { content: [{ type: "text", text: `ok — removed ${id}` }] };
  }

  if (name === "loose_tool_create") {
    const toolName = String(args?.name ?? "").trim();
    const description = String(args?.description ?? "").trim();
    const interpreter = String(args?.interpreter ?? "").trim();
    const code = String(args?.code ?? "");
    const argsHint = args?.argsHint ? String(args.argsHint) : "";
    if (!LOOSE_TOOL_NAME_RE.test(toolName)) {
      return { content: [{ type: "text", text: "name must match [a-z][a-z0-9_-]{0,40}" }], isError: true };
    }
    if (!description || !code) {
      return { content: [{ type: "text", text: "description and code are required" }], isError: true };
    }
    if (interpreter !== "bash" && interpreter !== "node") {
      return { content: [{ type: "text", text: "interpreter must be 'bash' or 'node'" }], isError: true };
    }
    const existing = loadLooseTools();
    if (existing.some((t) => t.name === toolName)) {
      return { content: [{ type: "text", text: `loose tool '${toolName}' already exists — remove it first` }], isError: true };
    }
    const ext = interpreter === "bash" ? "sh" : "js";
    const shebang = interpreter === "bash" ? "#!/bin/bash\nset -e\n" : "#!/usr/bin/env node\n";
    const scriptPath = resolve(LOOSE_TOOLS_DIR, `${toolName}.${ext}`);
    mkdirSync(LOOSE_TOOLS_DIR, { recursive: true });
    const finalCode = code.startsWith("#!") ? code : shebang + code;
    writeFileSync(scriptPath, finalCode, { mode: 0o755 });
    existing.push({
      name: toolName, description, interpreter, argsHint,
      path: scriptPath, createdAt: new Date().toISOString(),
    });
    saveLooseTools(existing);
    return { content: [{ type: "text", text: `ok — registered loose tool '${toolName}' at ${scriptPath}. Invoke with loose_tool_run({name: "${toolName}", args: ...})` }] };
  }

  if (name === "loose_tool_list") {
    return { content: [{ type: "text", text: JSON.stringify(loadLooseTools(), null, 2) }] };
  }

  if (name === "loose_tool_run") {
    const toolName = String(args?.name ?? "").trim();
    const tools = loadLooseTools();
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return { content: [{ type: "text", text: `no loose tool named '${toolName}' — list with loose_tool_list` }], isError: true };
    }
    if (!existsSync(tool.path)) {
      return { content: [{ type: "text", text: `loose tool script missing at ${tool.path} — index is stale` }], isError: true };
    }
    const payload = args?.args !== undefined ? JSON.stringify(args.args) : "{}";
    const { spawn } = await import("node:child_process");
    const cmd = tool.interpreter === "bash" ? "bash" : "node";
    return await new Promise((resolveCall) => {
      const child = spawn(cmd, [tool.path, payload], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); if (stdout.length > 16_384) child.kill("SIGKILL"); });
      child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 16_384) child.kill("SIGKILL"); });
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          return resolveCall({ content: [{ type: "text", text: stdout.slice(0, 16_384) || "(no output)" }] });
        }
        resolveCall({
          content: [{
            type: "text",
            text: `exit ${code}\n--- stdout ---\n${stdout.slice(-2000)}\n--- stderr ---\n${stderr.slice(-2000)}`,
          }],
          isError: true,
        });
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolveCall({ content: [{ type: "text", text: `spawn error: ${e.message}` }], isError: true });
      });
    });
  }

  if (name === "loose_tool_remove") {
    const toolName = String(args?.name ?? "").trim();
    const before = loadLooseTools();
    const tool = before.find((t) => t.name === toolName);
    if (!tool) return { content: [{ type: "text", text: `no loose tool named '${toolName}'` }], isError: true };
    try { rmSync(tool.path, { force: true }); } catch { /* ignore */ }
    saveLooseTools(before.filter((t) => t.name !== toolName));
    return { content: [{ type: "text", text: `ok — removed loose tool '${toolName}'` }] };
  }

  if (name === "slash_command_register") {
    const slashName = String(args?.name ?? "").trim().toLowerCase();
    const description = String(args?.description ?? "").trim();
    const looseToolName = String(args?.looseToolName ?? "").trim();
    const guildId = args?.guildId ? String(args.guildId) : null;
    const optionsIn = Array.isArray(args?.options) ? args.options : [];
    if (!SLASH_NAME_RE.test(slashName)) return { content: [{ type: "text", text: "name must match [\\w-]{1,32} lowercase" }], isError: true };
    if (!description || description.length > 100) return { content: [{ type: "text", text: "description required, max 100 chars" }], isError: true };
    if (!loadLooseTools().some((t) => t.name === looseToolName)) {
      return { content: [{ type: "text", text: `loose tool '${looseToolName}' does not exist — create it first with loose_tool_create` }], isError: true };
    }
    const options = optionsIn.map((o) => {
      const t = SLASH_OPTION_TYPES[o.type];
      if (!t) throw new Error(`unsupported option type: ${o.type}`);
      return { name: String(o.name).toLowerCase(), description: String(o.description), type: t, required: !!o.required };
    });
    const body = { name: slashName, description, type: 1, options };
    let created;
    try {
      created = await discordApi(guildId ? `/guilds/${guildId}/commands` : "/commands", "POST", body);
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
    const map = loadSlashCommands();
    map[slashName] = { looseToolName, guildId, commandId: created.id, registeredAt: new Date().toISOString() };
    saveSlashCommands(map);
    return { content: [{ type: "text", text: `ok — registered /${slashName} → ${looseToolName} (${guildId ? `guild ${guildId}` : "global"}), discord id ${created.id}. ${guildId ? "Visible immediately." : "May take up to 1 hour to appear in all guilds."}` }] };
  }

  if (name === "slash_command_list") {
    return { content: [{ type: "text", text: JSON.stringify(loadSlashCommands(), null, 2) }] };
  }

  if (name === "slash_command_unregister") {
    const slashName = String(args?.name ?? "").trim().toLowerCase();
    const guildId = args?.guildId ? String(args.guildId) : null;
    const map = loadSlashCommands();
    const entry = map[slashName];
    if (!entry) return { content: [{ type: "text", text: `no slash command named /${slashName}` }], isError: true };
    const effectiveGuild = guildId ?? entry.guildId ?? null;
    try {
      await discordApi(
        effectiveGuild ? `/guilds/${effectiveGuild}/commands/${entry.commandId}` : `/commands/${entry.commandId}`,
        "DELETE",
      );
    } catch (e) { return { content: [{ type: "text", text: e.message }], isError: true }; }
    delete map[slashName];
    saveSlashCommands(map);
    return { content: [{ type: "text", text: `ok — unregistered /${slashName}` }] };
  }

  if (name === "auto_respond_add") {
    const pattern = String(args?.pattern ?? "").trim();
    if (!pattern) {
      return { content: [{ type: "text", text: "pattern is required" }], isError: true };
    }
    const list = Array.isArray(cfg.autoRespondPatterns) ? cfg.autoRespondPatterns : [];
    if (!list.some((p) => p.toLowerCase() === pattern.toLowerCase())) {
      list.push(pattern);
    }
    cfg.autoRespondPatterns = list;
    saveConfig(cfg);
    return {
      content: [
        { type: "text", text: `ok — autoRespondPatterns = ${JSON.stringify(list)}` },
      ],
    };
  }

  if (name === "auto_respond_remove") {
    const pattern = String(args?.pattern ?? "").trim().toLowerCase();
    const list = (Array.isArray(cfg.autoRespondPatterns) ? cfg.autoRespondPatterns : []).filter(
      (p) => p.toLowerCase() !== pattern,
    );
    cfg.autoRespondPatterns = list;
    saveConfig(cfg);
    return {
      content: [
        { type: "text", text: `ok — autoRespondPatterns = ${JSON.stringify(list)}` },
      ],
    };
  }

  return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
