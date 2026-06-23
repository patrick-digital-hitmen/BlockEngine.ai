export interface SourceSection {
  id: string;
  title: string;
  html: string;
  text: string;
  kind: SectionKind;
}

export type SectionKind =
  | 'hero'
  | 'why'
  | 'services'
  | 'pricing'
  | 'process'
  | 'about'
  | 'faq'
  | 'contact'
  | 'generic';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'for', 'from', 'how', 'in', 'is', 'it',
  'of', 'on', 'or', 'our', 'the', 'this', 'to', 'we', 'with', 'you', 'your'
]);

const decodeWpRawHtml = (code: string) => {
  if (!code) return code;
  return code.replace(/\[vc_raw_html(?:\s+[^\]]*)?\](.*?)\[\/vc_raw_html\]/gs, (match, b64) => {
    try {
      return decodeURIComponent(atob(b64.trim()));
    } catch {
      return match;
    }
  });
};

const stripShortcodes = (value: string) => (
  value
    .replace(/\[\/?[a-zA-Z0-9_-]+(?:\s+[^\]]*)?\]/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
);

const normalizeText = (value: string) => (
  value
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/[^a-z0-9$#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const tokenize = (value: string) => (
  normalizeText(value)
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
);

const uniqueTokens = (value: string) => new Set(tokenize(value));

const inferKind = (text: string, html = ''): SectionKind => {
  const haystack = normalizeText(`${text} ${html}`);

  if (haystack.includes('home banner') || haystack.includes('hero section') || haystack.includes('tag h1') || /<h1[\s>]/i.test(html)) return 'hero';
  if (/\bfaq(s)?\b/.test(haystack) || haystack.includes('what is ') || haystack.includes('do you ')) return 'faq';
  if (haystack.includes('about ')) return 'about';
  if (haystack.includes('process works') || haystack.includes('initial review') || haystack.includes('document preparation')) return 'process';
  if (haystack.includes('how much') || haystack.includes('cost') || haystack.includes('pricing') || haystack.includes('from 1200') || haystack.includes('from 1500')) return 'pricing';
  if (haystack.includes('services') || haystack.includes('service grid') || haystack.includes('registrations')) return 'services';
  if (haystack.includes('why choose') || haystack.includes('award winning') || haystack.includes('senior advisors')) return 'why';
  if (haystack.startsWith('book a free strategy session') || haystack.includes('el id contact us section')) return 'contact';

  return 'generic';
};

const getTextFromHtml = (html: string) => {
  if (typeof DOMParser === 'undefined') return stripShortcodes(html.replace(/<[^>]*>/g, ' '));
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() || '';
};

const sectionFromNodes = (id: string, nodes: Element[]) => {
  const html = nodes.map(node => node.outerHTML).join('\n').trim();
  const titleNode = nodes.find(node => /^H[1-3]$/i.test(node.tagName));
  const title = titleNode?.textContent?.trim() || '';
  const text = nodes.map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
  return {
    id,
    title,
    html,
    text,
    kind: inferKind(`${title} ${text}`, html)
  };
};

export const extractSourceSections = (sourceHtml: string): SourceSection[] => {
  if (!sourceHtml.trim()) return [];

  if (typeof DOMParser === 'undefined') {
    return [{ id: 'full-source', title: '', html: sourceHtml, text: stripShortcodes(sourceHtml), kind: 'generic' }];
  }

  const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
  const body = doc.body;
  const nodes = Array.from(body.children);
  const sections: SourceSection[] = [];
  let current: Element[] = [];
  let sectionIndex = 0;

  const flush = () => {
    if (current.length === 0) return;
    sections.push(sectionFromNodes(`section-${sectionIndex++}`, current));
    current = [];
  };

  nodes.forEach(node => {
    const tag = node.tagName.toLowerCase();
    if ((tag === 'h1' || tag === 'h2') && current.length > 0) {
      flush();
    }
    current.push(node);
  });
  flush();

  if (sections.length === 0) {
    return [{ id: 'full-source', title: '', html: sourceHtml, text: body.textContent || sourceHtml, kind: 'generic' }];
  }

  return sections.map((section, index) => ({
    ...section,
    kind: index === 0 && (section.kind === 'generic' || /<h1[\s>]/i.test(section.html)) ? 'hero' : section.kind
  }));
};

const isDecorativeBlock = (blockCode: string) => {
  const decoded = decodeWpRawHtml(blockCode);
  const haystack = normalizeText(decoded);
  const hasNoMeaningfulText = getTextFromHtml(decoded).length < 80;

  return (
    haystack.includes('arrow down group') ||
    haystack.includes('award slider') ||
    haystack.includes('logoshowcase') ||
    haystack.includes('brb collection') ||
    haystack.includes('contact form 7') ||
    (haystack.includes('vc single image') && hasNoMeaningfulText) ||
    (haystack.includes('vc column text') && hasNoMeaningfulText && !haystack.includes('contact us section'))
  );
};

const inferBlockKind = (block: { name?: string; type?: string; originalCode?: string }) => {
  const decoded = decodeWpRawHtml(block.originalCode || '');
  const explicit = `${block.name || ''} ${block.type || ''}`;
  const headingText = [...decoded.matchAll(/(?:text|title)="([^"]+)"/g)]
    .map(match => match[1])
    .join(' ');
  const visibleText = getTextFromHtml(stripShortcodes(decoded));
  return inferKind(`${explicit} ${headingText} ${visibleText}`, decoded);
};

const lexicalScore = (source: SourceSection, blockText: string) => {
  const sourceTokens = uniqueTokens(`${source.title} ${source.text}`);
  const blockTokens = uniqueTokens(blockText);
  if (sourceTokens.size === 0 || blockTokens.size === 0) return 0;

  let overlap = 0;
  blockTokens.forEach(token => {
    if (sourceTokens.has(token)) overlap++;
  });

  return overlap / Math.sqrt(sourceTokens.size * blockTokens.size);
};

export const selectBestSourceSection = (
  block: { name?: string; type?: string; originalCode?: string; isVerbatim?: boolean },
  sourceSections: SourceSection[],
  usedSectionIds = new Set<string>()
) => {
  if (block.isVerbatim || isDecorativeBlock(block.originalCode || '')) return '';
  if (sourceSections.length === 0) return '';

  const decodedBlock = decodeWpRawHtml(block.originalCode || '');
  const blockText = `${block.name || ''} ${block.type || ''} ${getTextFromHtml(stripShortcodes(decodedBlock))}`;
  const blockKind = inferBlockKind(block);

  let best: { section: SourceSection; score: number } | null = null;

  sourceSections.forEach(section => {
    let score = lexicalScore(section, blockText);

    if (section.kind === blockKind) score += 3;
    if (usedSectionIds.has(section.id)) score -= 1.5;
    if (blockKind === 'hero' && section.kind === 'hero') score += 2;
    if (blockKind === 'faq' && section.kind === 'faq') score += 2;
    if (blockKind === 'contact' && section.kind === 'contact') score += 2;

    if (!best || score > best.score) {
      best = { section, score };
    }
  });

  if (!best || best.score < 0.2) return '';
  usedSectionIds.add(best.section.id);
  return best.section.html;
};

export const mapBlocksToSourceSections = <T extends { name?: string; type?: string; originalCode?: string; isVerbatim?: boolean }>(
  blocks: T[],
  sourceHtml: string
) => {
  const sourceSections = extractSourceSections(sourceHtml);
  const usedSectionIds = new Set<string>();
  return blocks.map(block => selectBestSourceSection(block, sourceSections, usedSectionIds));
};
