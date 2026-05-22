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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const CONFIG_FILE = resolve(process.env.KURUMI_CONFIG_FILE ?? "/state/kurumi-config.json");
const NOTES_FILE = resolve(process.env.KURUMI_NOTES_FILE ?? "/state/kurumi-notes.json");

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

// Settable keys with their schemas and human descriptions. Any key not in
// here is rejected by config_set. Free-form values are validated per-key;
// bad inputs come back as a tool error.
const SCHEMA = {
  model: {
    type: z.enum([
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
      "claude-opus-4-5",
      "sonnet",
      "opus",
      "haiku",
    ]),
    description:
      "Claude model used for every reply. haiku = cheap and fast, sonnet = balanced (default), opus = most capable and expensive.",
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
    type: z.enum([
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
      "claude-opus-4-5",
      "sonnet",
      "opus",
      "haiku",
    ]),
    description:
      "Model used for the should-I-respond decision in auto-respond zones. Defaults to haiku (cheap and fast). Switch to sonnet if she's making bad judgement calls.",
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
