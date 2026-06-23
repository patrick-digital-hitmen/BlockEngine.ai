type SchemaKind =
  | "hero"
  | "why"
  | "services"
  | "pricing"
  | "process"
  | "about"
  | "faq"
  | "contact"
  | "generic";

interface CtaPayload {
  text: string;
  href: string;
}

interface ItemPayload {
  title: string;
  body: string;
}

interface StepPayload {
  title: string;
  body: string;
}

interface ContentPayload {
  kind: SchemaKind;
  h1?: string;
  h2?: string;
  h3?: string;
  intro?: string;
  paragraphs: string[];
  cta?: CtaPayload;
  items: ItemPayload[];
  steps: StepPayload[];
  faqs: ItemPayload[];
  price?: string;
  inclusions: string[];
}

interface PatchOptions {
  globalButtonText?: string;
}

const decodeEntities = (value: string) => (
  String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
);

const escapeAttr = (value: string) => (
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
);

const normalizeSpace = (value: string) => decodeEntities(value).replace(/\s+/g, " ").trim();

const stripTags = (html: string) => normalizeSpace(
  String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
);

const getFirstTagText = (html: string, tag: string) => {
  const match = String(html || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
};

const getAllTagText = (html: string, tag: string) => (
  [...String(html || "").matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map(match => stripTags(match[1]))
    .filter(Boolean)
);

const getFirstAnchor = (html: string): CtaPayload | undefined => {
  const match = String(html || "").match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
  if (!match) return undefined;
  const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
  const text = stripTags(match[2]);
  return text ? { text, href } : undefined;
};

const htmlToParagraphs = (html: string) => (
  getAllTagText(html, "p").filter(text => text && !isLikelyCtaText(text))
);

const plainText = (html: string) => stripTags(html);

const inferKind = (blockCode: string, sourceHtml: string): SchemaKind => {
  const block = normalizeSpace(blockCode).toLowerCase();
  const source = normalizeSpace(sourceHtml).toLowerCase();
  const combined = `${block} ${source}`;

  if (/\[vc_tta_accordion\b/i.test(blockCode) || /\bfaq(s)?\b/i.test(block)) return "faq";
  if (/home-main-banner|home-banner|hero-section|tag:h1|<h1\b/i.test(blockCode)) return "hero";
  if (/pricing-card|card-price|price-from|card-price|how much|cost/i.test(block)) return "pricing";
  if (/process works|initial review|document preparation|<ol\b/i.test(block) || (/process/i.test(block) && /<ol\b/i.test(sourceHtml))) return "process";
  if (/why choose|award-winning|senior advisors|transparent pricing/i.test(block)) return "why";
  if (/service-card|services-grid|service-label|our .* services/i.test(block)) return "services";
  if (/\babout\b/i.test(block)) return "about";
  if (/el_id=["']contact-us-section|contact-us-box|contact-form-7/i.test(blockCode) || /^book a free strategy session$/i.test(getFirstTagText(sourceHtml, "h2"))) return "contact";

  if (/<h1\b/i.test(sourceHtml)) return "hero";
  if (/\bfaq(s)?\b/i.test(source)) return "faq";
  if (/how much|cost|from\s+\$[\d,]+/i.test(source)) return "pricing";
  if (/process works|initial review|document preparation/i.test(source)) return "process";
  if (/why choose|award-winning|senior advisors/i.test(source)) return "why";
  if (/our .* services|services\b/i.test(combined)) return "services";
  if (/\babout\b/i.test(source)) return "about";

  return "generic";
};

const splitLabelBody = (text: string): ItemPayload => {
  const normalized = normalizeSpace(text);
  const parts = normalized.match(/^([^:]{2,90}):\s*(.+)$/);
  if (parts) {
    return { title: parts[1].trim(), body: parts[2].trim() };
  }
  return { title: normalized, body: "" };
};

const extractH3Groups = (html: string) => {
  const matches = [...String(html || "").matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || html.length : html.length;
    const chunk = html.slice(start, end);
    const paragraph = getFirstTagText(chunk, "p") || stripTags(chunk);
    return {
      title: stripTags(match[1]),
      body: paragraph
    };
  }).filter(item => item.title);
};

const extractFaqs = (html: string) => extractH3Groups(html).filter(item => item.body);

const extractSteps = (html: string): StepPayload[] => {
  const olMatch = String(html || "").match(/<ol\b[^>]*>([\s\S]*?)<\/ol>/i);
  const liTexts = getAllTagText(olMatch ? olMatch[1] : html, "li");
  return liTexts.map(text => {
    const item = splitLabelBody(text);
    return { title: item.title, body: item.body };
  }).filter(step => step.title || step.body);
};

const extractLooseInclusions = (html: string, price = "") => {
  const ulItems = getAllTagText(html, "li");
  if (ulItems.length) return ulItems;

  const h3Match = String(html || "").match(/<h3\b[^>]*>[\s\S]*?<\/h3>([\s\S]*)$/i);
  let text = plainText(h3Match ? h3Match[1] : html);
  if (price) text = text.replace(price, " ");
  text = text.replace(/\bview inclusions\b/ig, " ").replace(/\s+/g, " ").trim();
  if (!text) return [];

  const knownDelimiter = text.match(/(?:^|\s)([A-Z][A-Za-z]*(?:\s+(?:&|and|to|of|for|[A-Z][A-Za-z]*|[A-Z]{2,})){0,6})(?=\s+[A-Z][a-z]+(?:\s|$))/g);
  if (!knownDelimiter || knownDelimiter.length < 3) return [text];

  return knownDelimiter
    .map(item => normalizeSpace(item))
    .filter(item => item.length > 2 && !/^from\s+\$/i.test(item));
};

const extractPayload = (sourceHtml: string, kind: SchemaKind): ContentPayload => {
  const h1 = getFirstTagText(sourceHtml, "h1");
  const h2 = getFirstTagText(sourceHtml, "h2");
  const h3 = getFirstTagText(sourceHtml, "h3");
  const paragraphs = htmlToParagraphs(sourceHtml);
  const h3Groups = extractH3Groups(sourceHtml);
  const listItems = getAllTagText(sourceHtml, "li").map(splitLabelBody);
  const cta = getFirstAnchor(sourceHtml);
  const price = plainText(sourceHtml).match(/\bfrom\s+\$[\d,]+(?:\s+[a-z-]+)?/i)?.[0] || "";

  return {
    kind,
    h1,
    h2,
    h3,
    intro: paragraphs[0] || "",
    paragraphs,
    cta,
    items: h3Groups.length ? h3Groups : listItems,
    steps: extractSteps(sourceHtml),
    faqs: extractFaqs(sourceHtml),
    price,
    inclusions: extractLooseInclusions(sourceHtml, price)
  };
};

const isLikelyCtaText = (text: string) => (
  /^(book|request|get|call|learn|contact|start|submit)\b/i.test(normalizeSpace(text))
);

const setShortcodeAttr = (attrs: string, name: string, value: string) => {
  if (new RegExp(`\\b${name}="[^"]*"`, "i").test(attrs)) {
    return attrs.replace(new RegExp(`\\b${name}="[^"]*"`, "i"), () => `${name}="${escapeAttr(value)}"`);
  }
  return `${attrs} ${name}="${escapeAttr(value)}"`;
};

const replaceCustomHeadings = (code: string, values: string[]) => {
  let index = 0;
  return code.replace(/\[vc_custom_heading\b([^\]]*)\]/gi, (match, attrs) => {
    const value = values[index++];
    if (!value) return match;
    return `[vc_custom_heading${setShortcodeAttr(attrs, "text", value)}]`;
  });
};

const replaceColumnTexts = (code: string, values: string[]) => {
  let index = 0;
  return code.replace(/\[vc_column_text([^\]]*)\]([\s\S]*?)\[\/vc_column_text\]/gi, (match, attrs) => {
    const value = values[index++];
    if (value == null) return match;
    return `[vc_column_text${attrs}]\n${value}\n[/vc_column_text]`;
  });
};

const replaceButtons = (code: string, payload: ContentPayload, options: PatchOptions) => {
  const text = options.globalButtonText || payload.cta?.text || "";
  const href = payload.cta?.href || "";

  return code.replace(/\[tek_button\b([^\]]*)\]/gi, (match, attrs) => {
    let nextAttrs = attrs;
    if (text) nextAttrs = setShortcodeAttr(nextAttrs, "button_text", text.toUpperCase());
    if (href) nextAttrs = setShortcodeAttr(nextAttrs, "button_link", `url:${href.replace("#", "%23")}`);
    return `[tek_button${nextAttrs}]`;
  });
};

const itemListHtml = (items: ItemPayload[]) => (
  `<ul>\n${items.map(item => {
    if (item.body) return `\t<li><strong>${escapeHtml(item.title)}:</strong> ${escapeHtml(item.body)}</li>`;
    return `\t<li>${escapeHtml(item.title)}</li>`;
  }).join("\n")}\n</ul>`
);

const orderedStepsHtml = (steps: StepPayload[]) => (
  `<ol>\n${steps.map(step => {
    if (step.body) return `\t<li><strong>${escapeHtml(step.title)}:</strong> ${escapeHtml(step.body)}</li>`;
    return `\t<li>${escapeHtml(step.title)}</li>`;
  }).join("\n")}\n</ol>`
);

const paragraphsHtml = (paragraphs: string[]) => paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("\n");

const escapeHtml = (value: string) => (
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
);

const replaceFirstTagText = (html: string, tag: string, value: string) => {
  if (!value) return html;
  return html.replace(new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)(<\\/${tag}>)`, "i"), (_match, before, _old, after) => `${before}${escapeHtml(value)}${after}`);
};

const replaceFirstClassText = (html: string, className: string, value: string) => {
  if (!value) return html;
  const classPattern = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(<([a-z0-9]+)\\b(?=[^>]*class=["'][^"']*${classPattern}[^"']*["'][^>]*)(?:[^>]*)>)([\\s\\S]*?)(<\\/\\2>)`, "i");
  return html.replace(re, (_match, before, _tag, _old, after) => `${before}${escapeHtml(value)}${after}`);
};

const patchServiceRawHtml = (html: string, payload: ContentPayload) => {
  if (!/service-card|services-grid/i.test(html) || payload.items.length === 0) return html;

  let out = replaceFirstTagText(html, "h2", payload.h2 || "Services");
  out = out.replace(/(<div\b[^>]*class=["'][^"']*section-header[^"']*["'][^>]*>[\s\S]*?<h2\b[^>]*>[\s\S]*?<\/h2>\s*<p\b[^>]*>)([\s\S]*?)(<\/p>)/i, (match, before, _old, after) => {
    if (!payload.intro) return match;
    return `${before}${escapeHtml(payload.intro)}${after}`;
  });

  let itemIndex = 0;
  out = out.replace(/<article\b[^>]*class=["'][^"']*service-card[^"']*["'][^>]*>[\s\S]*?<\/article>/gi, (card) => {
    const item = payload.items[itemIndex++];
    if (!item) return "";

    let next = replaceFirstClassText(card, "service-label", serviceLabel(payload));
    next = replaceFirstTagText(next, "h3", item.title);
    next = replaceFirstTagText(next, "p", item.body);
    return next;
  });

  return out;
};

const serviceLabel = (payload: ContentPayload) => {
  const heading = payload.h2 || payload.h1 || "Service";
  return heading
    .replace(/^our\s+/i, "")
    .replace(/\s+services?$/i, "")
    .trim() || "Service";
};

const patchPricingRawHtml = (html: string, payload: ContentPayload) => {
  if (!/pricing|card-price|inclusions/i.test(html)) return html;

  let out = replaceFirstClassText(html, "m2-cc-card-title", payload.h3 || payload.h2 || "Pricing");
  out = replaceFirstClassText(out, "m2-cc-card-price", cleanPrice(payload.price));
  out = replaceFirstClassText(out, "m2-cc-price-from", pricePrefix(payload.price));

  if (payload.inclusions.length > 0) {
    let inclusionIndex = 0;
    out = out.replace(/(<div\b[^>]*class=["'][^"']*m2-cc-inclusion-item[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/gi, (match, before, _old, after) => {
      const inclusion = payload.inclusions[inclusionIndex++];
      return inclusion ? `${before}${escapeHtml(inclusion)}${after}` : "";
    });
  }

  return out;
};

const cleanPrice = (price = "") => {
  const match = price.match(/\$[\d,]+/);
  return match ? match[0] : price.replace(/^from\s+/i, "").trim();
};

const pricePrefix = (price = "") => {
  if (!price) return "";
  return /^from\b/i.test(price) ? price.replace(/\s*\$[\d,]+.*$/i, "").toUpperCase() || "FROM" : "";
};

const patchRawHtmlBlocks = (code: string, payload: ContentPayload) => (
  code.replace(/\[vc_raw_html([^\]]*)\]([\s\S]*?)\[\/vc_raw_html\]/gi, (match, attrs, html) => {
    let patched = html;
    if (payload.kind === "services") patched = patchServiceRawHtml(patched, payload);
    if (payload.kind === "pricing") patched = patchPricingRawHtml(patched, payload);
    return patched === html ? match : `[vc_raw_html${attrs}]${patched}[/vc_raw_html]`;
  })
);

const patchFaqAccordion = (code: string, payload: ContentPayload) => {
  if (payload.faqs.length === 0 || !/\[vc_tta_accordion\b/i.test(code)) return code;

  const sections = [...code.matchAll(/\[vc_tta_section\b([^\]]*)\]([\s\S]*?)\[\/vc_tta_section\]/gi)];
  if (sections.length === 0) return code;

  const firstStart = sections[0].index || 0;
  const last = sections[sections.length - 1];
  const lastEnd = (last.index || 0) + last[0].length;
  const template = sections[0][0];

  const replacement = payload.faqs.map((faq, index) => {
    let section = template.replace(/\[vc_tta_section\b([^\]]*)\]/i, (match, attrs) => {
      let nextAttrs = setShortcodeAttr(attrs, "title", faq.title);
      nextAttrs = setShortcodeAttr(nextAttrs, "tab_id", `generated-faq-${index}-${stableId(faq.title)}`);
      return `[vc_tta_section${nextAttrs}]`;
    });
    section = section.replace(/\[vc_column_text([^\]]*)\]([\s\S]*?)\[\/vc_column_text\]/i, (_match, attrs) => `[vc_column_text${attrs}]${escapeHtml(faq.body)}[/vc_column_text]`);
    return section;
  }).join("");

  return `${code.slice(0, firstStart)}${replacement}${code.slice(lastEnd)}`;
};

const stableId = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash) + value.charCodeAt(i);
  return Math.abs(hash).toString(36);
};

const patchStandardShortcodes = (code: string, payload: ContentPayload, options: PatchOptions) => {
  let out = code;

  if (payload.kind === "hero") {
    out = replaceCustomHeadings(out, [payload.h1 || payload.h2 || ""]);
    out = replaceColumnTexts(out, [payload.intro ? `<p style="text-align: center; color: #ffffff;">${escapeHtml(payload.intro)}</p>` : ""]);
  } else if (payload.kind === "why") {
    out = replaceCustomHeadings(out, [payload.h2 || ""]);
    out = replaceColumnTexts(out, [itemListHtml(payload.items)]);
  } else if (payload.kind === "pricing") {
    out = replaceCustomHeadings(out, [payload.h2 || ""]);
    out = replaceColumnTexts(out, [payload.intro || ""]);
  } else if (payload.kind === "process") {
    out = replaceCustomHeadings(out, [payload.h2 || ""]);
    out = replaceColumnTexts(out, [orderedStepsHtml(payload.steps)]);
  } else if (payload.kind === "about") {
    out = replaceCustomHeadings(out, [payload.h2 || "About"]);
    out = replaceColumnTexts(out, [paragraphsHtml(payload.paragraphs)]);
  } else if (payload.kind === "contact") {
    out = replaceCustomHeadings(out, [payload.h2 || payload.h1 || "Book a Free Strategy Session"]);
  }

  out = replaceButtons(out, payload, options);
  return out;
};

export const tryPatchWpBakeryWithSchema = (
  decodedBlockCode: string,
  sourceHtml: string,
  options: PatchOptions = {}
) => {
  if (!decodedBlockCode || !sourceHtml || !/\[vc_|tek_button|vc_raw_html/i.test(decodedBlockCode)) return null;

  const kind = inferKind(decodedBlockCode, sourceHtml);
  if (kind === "generic") return null;

  const payload = extractPayload(sourceHtml, kind);
  let patched = decodedBlockCode;

  patched = patchStandardShortcodes(patched, payload, options);
  patched = patchRawHtmlBlocks(patched, payload);
  patched = patchFaqAccordion(patched, payload);

  return decodedBlockCode !== patched ? patched : null;
};
