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

const KIND_PRIORITY: SectionKind[] = ['hero', 'why', 'services', 'pricing', 'process', 'about', 'faq', 'contact', 'generic'];

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

const hasShortcode = (code: string, shortcodeName: string) => (
  new RegExp(`\\[${shortcodeName}\\b`, 'i').test(code)
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

const hasEditableStructure = (decodedBlock: string) => (
  hasShortcode(decodedBlock, 'vc_custom_heading') ||
  hasShortcode(decodedBlock, 'vc_column_text') ||
  hasShortcode(decodedBlock, 'tek_button') ||
  hasShortcode(decodedBlock, 'vc_tta_accordion') ||
  hasShortcode(decodedBlock, 'vc_tta_section') ||
  /<(h1|h2|h3|p|li)\b/i.test(decodedBlock)
);

const getTextFromHtml = (html: string) => {
  if (typeof DOMParser === 'undefined') return stripShortcodes(html.replace(/<[^>]*>/g, ' '));
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() || '';
};

const getSectionTitle = (nodes: Element[]) => {
  const h1 = nodes.find(node => node.tagName.toLowerCase() === 'h1')?.textContent?.trim();
  const h2 = nodes.find(node => node.tagName.toLowerCase() === 'h2')?.textContent?.trim();
  const firstHeading = nodes.find(node => /^H[1-3]$/i.test(node.tagName))?.textContent?.trim();

  if (h1 && h2) return `${h1} / ${h2}`;
  return h2 || h1 || firstHeading || '';
};

const sectionFromNodes = (id: string, nodes: Element[]) => {
  const html = nodes.map(node => node.outerHTML).join('\n').trim();
  const title = getSectionTitle(nodes);
  const text = nodes.map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
  return {
    id,
    title,
    html,
    text,
    kind: inferKind(`${title} ${text}`, html)
  };
};

const isWrappedSection = (node: Element) => {
  const tag = node.tagName.toLowerCase();
  return ['article', 'main', 'section'].includes(tag) || (tag === 'div' && !!node.querySelector('h1,h2'));
};

const buildSectionsFromWrappedNodes = (nodes: Element[]) => {
  const sections: SourceSection[] = [];
  let sectionIndex = 0;

  nodes.forEach(node => {
    if (isWrappedSection(node)) {
      sections.push(sectionFromNodes(`section-${sectionIndex++}`, [node]));
    }
  });

  return sections.length > 1 ? sections : [];
};

const unwrapSinglePageContainer = (nodes: Element[]) => {
  if (nodes.length !== 1 || !isWrappedSection(nodes[0])) return nodes;

  const children = Array.from(nodes[0].children);
  const directH2Count = children.filter(child => child.tagName.toLowerCase() === 'h2').length;
  return directH2Count > 1 ? children : nodes;
};

export const extractSourceSections = (sourceHtml: string): SourceSection[] => {
  if (!sourceHtml.trim()) return [];

  if (typeof DOMParser === 'undefined') {
    return [{ id: 'full-source', title: '', html: sourceHtml, text: stripShortcodes(sourceHtml), kind: 'generic' }];
  }

  const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
  const body = doc.body;
  const nodes = unwrapSinglePageContainer(Array.from(body.children));
  const wrappedSections = buildSectionsFromWrappedNodes(nodes);
  if (wrappedSections.length > 0) return wrappedSections;

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
    if (tag === 'h2' && current.length > 0) {
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
  const hasEditableContent = hasEditableStructure(decoded);

  return (
    (haystack.includes('arrow down group') && !hasEditableContent) ||
    (haystack.includes('award slider') && !hasEditableContent) ||
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

const firstUnusedSectionByKind = (
  sourceSections: SourceSection[],
  kind: SectionKind,
  usedSectionIds: Set<string>
) => sourceSections.find(section => section.kind === kind && !usedSectionIds.has(section.id));

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
  const exactKindMatch = blockKind !== 'generic' ? firstUnusedSectionByKind(sourceSections, blockKind, usedSectionIds) : undefined;
  if (exactKindMatch) {
    usedSectionIds.add(exactKindMatch.id);
    return exactKindMatch.html;
  }

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
  const mappedSnippets = blocks.map(() => '');
  const blockKinds = blocks.map(block => block.isVerbatim || isDecorativeBlock(block.originalCode || '') ? 'generic' : inferBlockKind(block));

  KIND_PRIORITY.forEach(kind => {
    blocks.forEach((block, index) => {
      if (mappedSnippets[index] || blockKinds[index] !== kind || kind === 'generic') return;
      mappedSnippets[index] = selectBestSourceSection(block, sourceSections, usedSectionIds);
    });
  });

  blocks.forEach((block, index) => {
    if (mappedSnippets[index]) return;
    mappedSnippets[index] = selectBestSourceSection(block, sourceSections, usedSectionIds);
  });

  return mappedSnippets;
};
