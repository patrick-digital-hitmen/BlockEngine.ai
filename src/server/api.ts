import express from "express";
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { tryPatchWpBakeryWithSchema } from "./wpBakerySchemaPatcher";

export const apiRouter = express.Router();

apiRouter.use(express.json());

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: { headers: { "User-Agent": "blockengine-ai" } }
});

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Helpers for WPBakery base64 encoded HTML
const decodeWpCode = (code: string) => {
  if (!code) return code;
  return code.replace(/\[vc_raw_html([^\]]*)\](.*?)\[\/vc_raw_html\]/gs, (match, attrs, b64) => {
    try {
      // WPBakery uses URL encoding THEN Base64 encoding for raw HTML
      return `[vc_raw_html${attrs}]${decodeURIComponent(Buffer.from(b64.trim(), "base64").toString())}[/vc_raw_html]`;
    } catch {
      return match;
    }
  });
};

const encodeWpCode = (code: string) => {
  if (!code) return code;
  return code.replace(/\[vc_raw_html([^\]]*)\](.*?)\[\/vc_raw_html\]/gs, (match, attrs, htmlContent) => {
    try {
      return `[vc_raw_html${attrs}]${Buffer.from(encodeURIComponent(htmlContent.trim())).toString("base64")}[/vc_raw_html]`;
    } catch {
      return match;
    }
  });
};

const decodeGeneratedEntities = (text: string) => (
  text
    .replace(/&#60;/g, "<")
    .replace(/&#62;/g, ">")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
);

const getVisibleText = (html: string) => (
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
);

const isProtectedRawHtml = (html: string) => {
  const normalized = html.toLowerCase();
  const visibleText = getVisibleText(html);

  return (
    normalized.includes("arrow-down-group") ||
    normalized.includes("award-slider") ||
    normalized.includes("logoshowcase") ||
    normalized.includes("brb_collection") ||
    normalized.includes("contact-form-7") ||
    (visibleText.length < 40 && !/<(h1|h2|h3|p|li)\b/i.test(html))
  );
};

const protectRawHtml = (code: string) => {
  const protectedBlocks: string[] = [];
  const codeWithPlaceholders = code.replace(/\[vc_raw_html[^\]]*\]([\s\S]*?)\[\/vc_raw_html\]/g, (match, htmlContent) => {
    if (!isProtectedRawHtml(htmlContent)) return match;

    const placeholder = `__BLOCKENGINE_PROTECTED_RAW_HTML_${protectedBlocks.length}__`;
    protectedBlocks.push(match);
    return placeholder;
  });

  return { codeWithPlaceholders, protectedBlocks };
};

const restoreProtectedRawHtml = (code: string, protectedBlocks: string[]) => (
  protectedBlocks.reduce(
    (restored, block, index) => restored.replace(new RegExp(`__BLOCKENGINE_PROTECTED_RAW_HTML_${index}__`, "g"), block),
    code
  )
);

const protectAssetLiterals = (code: string) => {
  const protectedAssets: string[] = [];
  const codeWithAssetPlaceholders = code.replace(/https?:\/\/[^\s"'})\]]+/g, (url) => {
    const placeholder = `__BLOCKENGINE_PROTECTED_ASSET_${protectedAssets.length}__`;
    protectedAssets.push(url);
    return placeholder;
  });

  return { codeWithAssetPlaceholders, protectedAssets };
};

const restoreAssetLiterals = (code: string, protectedAssets: string[]) => (
  protectedAssets.reduce(
    (restored, asset, index) => restored.replace(new RegExp(`__BLOCKENGINE_PROTECTED_ASSET_${index}__`, "g"), asset),
    code
  )
);

// AI Generation Route
apiRouter.post("/generate", async (req, res) => {
  const { blockCode, writingInstructions, replacementContent, builderType, mode, engine = 'gemini', model, rewriteContent, globalButtonText } = req.body;

  const shouldRewrite = rewriteContent !== false; // Defaults to true
  const decodedBlockCode = decodeWpCode(blockCode);

  if (builderType === "wp-bakery" && replacementContent?.trim()) {
    const schemaPatched = tryPatchWpBakeryWithSchema(decodedBlockCode, replacementContent, { globalButtonText });
    if (schemaPatched) {
      return res.json({ result: encodeWpCode(schemaPatched) });
    }
  }

  const { codeWithPlaceholders, protectedBlocks } = protectRawHtml(decodedBlockCode);
  const { codeWithAssetPlaceholders, protectedAssets } = protectAssetLiterals(codeWithPlaceholders);

  if (!blockCode || !writingInstructions || !builderType) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  let resolvedEngine = engine;
  const activeModel = model || (engine === "gemini-pro" ? "gemini-3.1-pro-preview" : "gemini-3.5-flash");
  if (activeModel.startsWith("llama") || activeModel.startsWith("meta-llama") || activeModel.startsWith("mixtral") || activeModel.startsWith("gemma")) {
    resolvedEngine = "groq";
  }

  try {
    let systemInstruction = `You are an expert Content Migration Specialist and WordPress Architect.
Your job is to rewrite the TARGET CODE BLOCK using the SOURCE REPLACEMENT CONTENT as the only factual source.

The TARGET CODE BLOCK is a structural template. The SOURCE REPLACEMENT CONTENT is the mapped content slice for this exact template block, not a suggestion.

Non-negotiable preservation rules:
1. Preserve every shortcode tag, shortcode nesting level, attribute name, CSS class, ID, image ID, column width, animation, inline style, script, link target format and raw structural wrapper unless the attribute is visibly human copy.
2. Preserve WPBakery syntax exactly. Never convert shortcodes into plain HTML.
3. Preserve the number and order of structural repeated items in the target block. If the source has more items than the template, use the best-fitting first items. If the source has fewer items, reuse only source facts and leave extra structure concise rather than inventing.
4. For [vc_raw_html] blocks, the HTML has been decoded for you. Update visible copy inside the decoded HTML, preserve markup/classes/scripts/styles, and the server will re-encode it.
5. Replace old-topic visible copy completely. Do not leave stale terms such as Company Registration, ASIC, shares or directors when the source is about Trust Establishment unless the source itself mentions them.
6. Keep CTA text and anchors aligned with the source. If the source contains an anchor like #contact-us-section, keep the WPBakery button_link url:%23contact-us-section format.
7. Preserve any __BLOCKENGINE_PROTECTED_*__ placeholders exactly. They represent protected images, URLs, scripts, forms, or decorative HTML that will be restored after generation.
8. Return only final raw code. No markdown fences, commentary, notes, JSON or explanations.

Content mapping rules:
- Hero blocks: map H1, intro paragraph and first CTA.
- Why/benefits blocks: map the source list items in order and preserve <strong> descriptor formatting.
- Service grids/cards: map source H3 service headings and their following paragraphs to existing cards in order.
- Pricing blocks: map the heading, price and inclusions exactly from the source pricing section.
- Process blocks: map ordered-list steps in order.
- About blocks: map the About section paragraphs.
- FAQ accordion blocks: map each source H3 question to an accordion title and the following paragraph to its answer.
- Contact blocks: map only the booking/contact heading and preserve the form shortcode.

Writing mode:
${shouldRewrite ? '- Rewrite source facts to fit the target block length and tone while preserving meaning.' : '- Inject source wording as directly as possible while preserving valid target syntax.'}`;

    if (resolvedEngine === 'groq') {
       systemInstruction += `\n\nCRITICAL: DO NOT output binary characters or mojibake.`;
    }

    const promptMessage = `
SOURCE REPLACEMENT CONTENT (FACTS TO USE):
${replacementContent}

TARGET CODE BLOCK TO REWRITE (STRUCTURAL TEMPLATE):
${codeWithAssetPlaceholders}

CONTEXT:
- Builder: ${builderType}
- Specific Instructions: ${writingInstructions}
- Mode: ${mode}
${globalButtonText ? `- Button Overwrite: "${globalButtonText}"` : ''}
    `;

    let result = "";

    if (resolvedEngine === 'groq' && groq) {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: promptMessage }
        ],
        model: activeModel === "gemini-3.5-flash" || activeModel === "gemini-1.5-flash" ? "llama-3.3-70b-versatile" : activeModel,
        temperature: 0.1,
      });
      result = completion.choices[0]?.message?.content || "";
    } else {
      // Keep old saved settings working while defaulting to the current Gemini model family.
      const geminiModel = activeModel === "gemini-1.5-pro"
        ? "gemini-3.1-pro-preview"
        : activeModel === "gemini-1.5-flash"
          ? "gemini-3.5-flash"
          : activeModel;
      
      const response = await (genAI as any).models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts: [{ text: promptMessage }] }],
        config: { 
          systemInstruction, 
          temperature: 0.1 
        }
      });
      result = response.text || "";
    }

    const cleanResult = (text: string) => {
      let cleaned = text.trim();
      cleaned = cleaned.replace(/^```[a-z]*\n/gi, "");
      cleaned = cleaned.replace(/\n```$/g, "");
      cleaned = cleaned.replace(/^```/g, "");
      cleaned = cleaned.replace(/```$/g, "");
      return cleaned.trim();
    };

    const restoredAssetsResult = restoreAssetLiterals(decodeGeneratedEntities(cleanResult(result)), protectedAssets);
    const restoredResult = restoreProtectedRawHtml(restoredAssetsResult, protectedBlocks);
    const finalResult = encodeWpCode(restoredResult);
    
    if (finalResult.includes("\uFFFD") || (finalResult.match(/[^\x20-\x7E\s]/g) && (finalResult.match(/[^\x20-\x7E\s]/g)!.length > finalResult.length * 0.2))) {
       throw new Error("GARBAGE_OUTPUT_DETECTED");
    }

    res.json({ result: finalResult });
  } catch (error: any) {
    console.error("AI Error:", error);
    try {
      const fallbackResponse = await (genAI as any).models.generateContent({
         model: "gemini-3.1-pro-preview",
         contents: [{ role: "user", parts: [{ text: `SOURCE REPLACEMENT CONTENT:\n${replacementContent}\n\nTARGET CODE BLOCK:\n${codeWithAssetPlaceholders}` }] }],
         config: {
            systemInstruction: `Rewrite the TARGET CODE BLOCK using only SOURCE REPLACEMENT CONTENT. Preserve every shortcode, structural wrapper, class, style, image, script, form shortcode and ID unless it is visible human copy. Replace stale topic copy completely. Return only raw code.`,
            temperature: 0.1
         }
      });
      const fallbackResult = fallbackResponse.text || "";
      const cleanedFallback = fallbackResult.replace(/^```[a-z]*\n/gi, "").replace(/\n```$/g, "").trim();
      const restoredFallbackAssets = restoreAssetLiterals(decodeGeneratedEntities(cleanedFallback), protectedAssets);
      const restoredFallback = restoreProtectedRawHtml(restoredFallbackAssets, protectedBlocks);
      res.json({ result: encodeWpCode(restoredFallback) });
    } catch (fallbackError: any) {
      res.json({ result: blockCode });
    }
  }
});

// Auto-Classification Route
apiRouter.post("/classify", async (req, res) => {
  const { blockCode, model } = req.body;
  if (!blockCode) return res.status(400).json({ error: "Missing blockcode" });

  const decodedBlockCode = decodeWpCode(blockCode);
  const isGroqModel = model && (model.startsWith("llama") || model.startsWith("meta-llama") || model.startsWith("mixtral") || model.startsWith("gemma"));

  const systemInstruction = `Role: You are a strict UX/UI Blueprint Architect. Your task is to analyze raw website code and classify the section into a generic, industry-standard wireframe component name AND determine its primary structural type.

CRITICAL RULE: Never use brand names or industry keywords.
CORE DICTIONARY: Hero Section, Services Grid, Image + Text, Trust Bar, Reviews, Pricing Grid, FAQ Section, About Us, Contact Form.

Return JSON:
{
  "type": "Primary Purpose",
  "name": "Component Name",
  "textPreview": "Max 100 chars text",
  "cleanHtml": "Pure HTML extract"
}

Code:
${decodedBlockCode.substring(0, 3500)}`;

  const classifyWithGemini = async (mdl: string) => {
    const geminiMdl = mdl === "gemini-1.5-flash"
      ? "gemini-3.5-flash"
      : mdl === "gemini-1.5-pro"
        ? "gemini-3.1-pro-preview"
        : mdl;
    const resp = await (genAI as any).models.generateContent({
      model: geminiMdl,
      contents: [{ role: "user", parts: [{ text: systemInstruction }] }],
      config: { 
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });
    return JSON.parse(resp.text || '{}');
  };

  const classifyWithGroq = async (mdl: string) => {
    if (!groq) throw new Error("GROQ_API_KEY is missing");
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: systemInstruction }],
      model: mdl,
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    return JSON.parse(completion.choices[0]?.message?.content || '{}');
  };

  try {
    let data: any = {};
    try {
      if (isGroqModel) {
        data = await classifyWithGroq(model || "llama-3.1-8b-instant");
      } else {
        data = await classifyWithGemini(model || "gemini-3.5-flash");
      }
    } catch (primaryError) {
      console.error("Primary classification failed, falling back to gemini-3.5-flash...", primaryError);
      data = await classifyWithGemini("gemini-3.5-flash");
    }
    
    res.json({ 
      type: data.type || "Content/Text Section",
      name: data.name || "Component",
      textPreview: data.textPreview || "",
      cleanHtml: data.cleanHtml || ""
    });
  } catch (e: any) {
    console.error(e);
    res.json({ type: "Content/Text Section", name: "Component", textPreview: "", cleanHtml: "" }); // Fallback
  }
});

apiRouter.get("/health", (req, res) => {
  res.json({ status: "ok" });
});
