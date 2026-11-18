// Report activity only. An empty successful response leaves Claude's decision alone.
const fs = require("node:fs");
const [file, sessionID] = process.argv.slice(2);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 1024 * 1024) process.exit(0);
});
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.session_id !== sessionID || event.agent_id || event.agent_transcript_path) return;
    fs.appendFileSync(file, JSON.stringify({
      type: event.hook_event_name,
      source: event.source,
      tool: event.tool_name,
      notification: event.notification_type,
    }) + "\n", { mode: 0o600 });
  } catch {}
});
