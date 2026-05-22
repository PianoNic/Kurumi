import { query } from "@anthropic-ai/claude-agent-sdk";

if (process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n❌ ANTHROPIC_API_KEY is set in the environment.\n" +
      "   The Agent SDK will silently use it instead of your Claude Max OAuth token,\n" +
      "   and you will be billed against API credits instead of your subscription.\n" +
      "   Unset it before running. In this container, ensure your compose file does\n" +
      "   not pass it through.\n",
  );
  process.exit(1);
}

const response = query({
  prompt: "Say hello in one short sentence.",
  options: {
    allowedTools: [],
  },
});

for await (const message of response) {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text") {
        process.stdout.write(block.text);
      }
    }
  } else if (message.type === "result") {
    process.stdout.write("\n");
    if (message.subtype === "success") {
      console.error(
        `\n✓ done — turns: ${message.num_turns}, ` +
          `duration: ${message.duration_ms}ms, ` +
          `session: ${message.session_id}`,
      );
    } else {
      console.error(`\n⚠ result subtype: ${message.subtype}`);
    }
  }
}
