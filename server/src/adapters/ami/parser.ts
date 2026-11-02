export interface AmiMessage {
  kind: "event" | "response" | "unknown";
  fields: Record<string, string>;
}

/**
 * AMI frames are `Key: value` lines separated by a blank line.
 * A banner such as `Asterisk Call Manager/18.x` has no colon and is ignored.
 * Incomplete trailing bytes are returned as `rest`.
 */
export function consumeAmiBuffer(buffer: string): { messages: AmiMessage[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const messages: AmiMessage[] = [];
  let rest = normalized;
  while (true) {
    const split = rest.indexOf("\n\n");
    if (split === -1) break;
    const block = rest.slice(0, split);
    rest = rest.slice(split + 2);
    const message = parseBlock(block);
    if (message) messages.push(message);
  }
  return { messages, rest };
}

function parseBlock(block: string): AmiMessage | null {
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!key) continue;
    fields[key] = value;
  }
  if (Object.keys(fields).length === 0) return null;
  if (fields.Event) return { kind: "event", fields };
  if (fields.Response) return { kind: "response", fields };
  return { kind: "unknown", fields };
}
