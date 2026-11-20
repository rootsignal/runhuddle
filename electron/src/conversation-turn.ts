export function latestConversationTurn(messages: readonly { role: string; text: string }[]) {
  const newestFirst = [...messages].reverse();
  const lastInstruction = newestFirst.findIndex((message) => message.role === "user");
  const instruction = newestFirst[lastInstruction]?.text
    .replace(/<environment_context(?:\s[^>]*)?>[\s\S]*?<\/environment_context>/gi, "")
    .replace(/<image\b(?=[^>]*\bpath\s*=)[^>]*>(?:\s*<\/image>)?/gi, "")
    .replace(/\[Image #\d+\]\s*/gi, "")
    .trim();
  const turn = lastInstruction < 0 ? newestFirst : newestFirst.slice(0, lastInstruction);
  const reply = turn.find((message) => message.role === "assistant")?.text.trim();
  return { instruction, reply };
}
