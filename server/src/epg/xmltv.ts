import { XMLParser } from "fast-xml-parser";

// Parses the raw text from GET /xmltv.php into programme entries, keyed by
// the provider's own channel id (the XMLTV <channel id> attribute — see
// xtream.ts's fetchXmltv comment for why this is a *different* id than
// stream_id, and needs translating via fetchChannels()'s epgChannelId
// before it means anything to this app).

export type XmltvProgramme = {
  channelId: string;
  start: Date;
  stop: Date;
  title: string;
  description: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Force array mode regardless of count — fast-xml-parser otherwise
  // collapses a single <programme> (or a provider with exactly one
  // channel) into a bare object instead of a one-element array.
  isArray: (name) => name === "programme",
});

// XMLTV datetime: "20260721053700 +0000" (YYYYMMDDHHMMSS, space, UTC
// offset). Not directly parseable by `Date` — reassembled into an ISO
// string. Verified live against a real provider's dump: offsets seen were
// always +0000, but the format allows any.
function parseXmltvDatetime(raw: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/.exec(raw.trim());
  if (!match) {
    throw new Error(`unrecognized XMLTV datetime: ${raw}`);
  }
  const [, year, month, day, hour, minute, second, offset] = match;
  const offsetStr = offset ? `${offset.slice(0, 3)}:${offset.slice(3)}` : "+00:00";
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offsetStr}`);
}

// <title>/<desc> normally parse to a plain string, but the XMLTV DTD
// allows a `lang` attribute on either — fast-xml-parser then nests the
// text under `#text` instead. Handles both shapes.
function textContent(node: unknown): string | undefined {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "#text" in node) {
    return String((node as { "#text": unknown })["#text"]);
  }
  return undefined;
}

export function parseXmltvProgrammes(xml: string): XmltvProgramme[] {
  const doc = parser.parse(xml) as {
    tv?: {
      programme?: Array<{
        "@_channel": string;
        "@_start": string;
        "@_stop": string;
        title?: unknown;
        desc?: unknown;
      }>;
    };
  };

  const programmes = doc.tv?.programme ?? [];
  const result: XmltvProgramme[] = [];
  for (const p of programmes) {
    const title = textContent(p.title);
    if (!title) continue; // a programme with no title isn't useful to match rules against
    result.push({
      channelId: p["@_channel"],
      start: parseXmltvDatetime(p["@_start"]),
      stop: parseXmltvDatetime(p["@_stop"]),
      title,
      description: textContent(p.desc) ?? null,
    });
  }
  return result;
}
