import { Lexer, type Token, type Tokens } from 'marked';

export type BriefInline =
  | { type: 'text' | 'code'; text: string }
  | { type: 'break' }
  | { type: 'strong' | 'em' | 'del'; children: BriefInline[] }
  | { type: 'link'; href: string; children: BriefInline[] };

export type BriefBlock =
  | { type: 'paragraph' | 'heading'; children: BriefInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: BriefBlock[][] }
  | { type: 'quote'; blocks: BriefBlock[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | { type: 'table'; header: BriefInline[][]; rows: BriefInline[][][] };

export type BriefSection = { id: string; title: string; blocks: BriefBlock[] };
export type BriefSource = { label: string; href: string };
export type DailyBrief = {
  id: string;
  title: string;
  generated: string;
  marketState: string;
  cutoff: string;
  raw: string;
  sections: BriefSection[];
  sources: BriefSource[];
  readingMinutes: number;
};

export function safeBriefUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch {
    return;
  }
}

function inlineText(nodes: BriefInline[]): string {
  return nodes.map((node) => 'text' in node ? node.text : 'children' in node ? inlineText(node.children) : ' ').join('');
}

function inlines(tokens: Token[], sources: Map<string, BriefSource>): BriefInline[] {
  return tokens.flatMap((token): BriefInline[] => {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
        return [{ type: token.type, children: inlines(token.tokens ?? [], sources) }];
      case 'link': {
        const link = token as Tokens.Link;
        const children = inlines(link.tokens, sources);
        const href = safeBriefUrl(link.href);
        if (!href) return children;
        if (!sources.has(href)) sources.set(href, { href, label: inlineText(children) });
        return [{ type: 'link', href, children }];
      }
      case 'br': return [{ type: 'break' }];
      case 'codespan': return [{ type: 'code', text: token.text }];
      case 'text':
        return token.tokens ? inlines(token.tokens, sources) : [{ type: 'text', text: token.text }];
      case 'image':
        return [{ type: 'text', text: (token as Tokens.Image).text }];
      default:
        // Raw HTML is text, never executable markup. Only explicit links load a source.
        return [{ type: 'text', text: 'text' in token && typeof token.text === 'string' ? token.text : token.raw }];
    }
  });
}

function blocks(tokens: Token[], sources: Map<string, BriefSource>): BriefBlock[] {
  return tokens.flatMap((token): BriefBlock[] => {
    switch (token.type) {
      case 'space':
      case 'def': return [];
      case 'paragraph':
      case 'text':
      case 'heading':
        return [{ type: token.type === 'heading' ? 'heading' : 'paragraph', children: inlines(token.tokens ?? [{ type: 'text', raw: token.raw, text: token.text }], sources) }];
      case 'list': {
        const list = token as Tokens.List;
        return [{ type: 'list', ordered: list.ordered, start: Number(list.start) || 1, items: list.items.map((item) => blocks(item.tokens, sources)) }];
      }
      case 'blockquote': return [{ type: 'quote', blocks: blocks(token.tokens ?? [], sources) }];
      case 'code': return [{ type: 'code', text: token.text }];
      case 'hr': return [{ type: 'rule' }];
      case 'table': {
        const table = token as Tokens.Table;
        return [{ type: 'table', header: table.header.map((cell) => inlines(cell.tokens, sources)), rows: table.rows.map((row) => row.map((cell) => inlines(cell.tokens, sources))) }];
      }
      default:
        return [{ type: 'paragraph', children: [{ type: 'text', text: token.raw }] }];
    }
  });
}

export function parseDailyBrief(title: string, markdown: string): DailyBrief {
  const raw = markdown.trim();
  const generated = raw.match(/^Generated: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \(Europe\/London\)\s*$/m)?.[1];
  const marketState = raw.match(/^Market state: (.+)$/m)?.[1]?.trim();
  const cutoff = raw.match(/^Data cutoff: (.+)$/m)?.[1]?.trim();
  if (!generated || !marketState || !cutoff) throw new Error('A brief needs its original London timestamp, market state, and data cutoff.');
  const id = generated.slice(0, 10);
  const date = new Date(`${generated.replace(' ', 'T')}:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16).replace('T', ' ') !== generated) throw new Error('Invalid brief publication date.');
  const start = raw.search(/^## /m);
  if (start < 0) throw new Error('A brief needs at least one section.');

  const sources = new Map<string, BriefSource>();
  const sections: BriefSection[] = [];
  let current: BriefSection | undefined;
  for (const token of Lexer.lex(raw.slice(start))) {
    if (token.type === 'heading' && token.depth === 2) {
      const heading = (token as Tokens.Heading).text.replace(/^\d+[.)]\s*/, '');
      current = { id: `brief-section-${sections.length + 1}`, title: heading, blocks: [] };
      sections.push(current);
    } else if (current) {
      current.blocks.push(...blocks([token], sources));
    }
  }

  // Preserve the original caveat text while giving it a visible place in the reader.
  const last = sections.at(-1);
  const caveat = last?.blocks.at(-1);
  if (last && caveat?.type === 'paragraph' && /^(Data gaps|Coverage gaps|Data caveats):/i.test(inlineText(caveat.children))) {
    last.blocks.pop();
    sections.push({ id: `brief-section-${sections.length + 1}`, title: 'Data caveats', blocks: [caveat] });
  }

  const wordCount = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split(/\s+/).length;
  return { id, title, generated, marketState, cutoff, raw, sections, sources: [...sources.values()], readingMinutes: Math.max(1, Math.ceil(wordCount / 230)) };
}

export function londonDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function formatBriefDate(id: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...(style === 'long' ? { weekday: 'long' as const, day: 'numeric' as const, month: 'long' as const, year: 'numeric' as const } : { day: 'numeric' as const, month: 'short' as const, year: 'numeric' as const }) }).format(new Date(`${id}T12:00:00Z`));
}

export function editionStatus(brief: DailyBrief, latestId: string, now = new Date()): 'today' | 'latest' | 'archive' {
  if (brief.id === londonDateKey(now)) return 'today';
  return brief.id === latestId ? 'latest' : 'archive';
}
