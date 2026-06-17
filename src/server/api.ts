import express from "express";
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";

export const apiRouter = express.Router();

apiRouter.use(express.json());

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: { headers: { "User-Agent": "aistudio-build" } }
});

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Helpers for WPBakery base64 encoded HTML
const decodeWpCode = (code: string) => {
  if (!code) return code;
  return code.replace(/\[vc_raw_html\](.*?)\[\/vc_raw_html\]/gs, (match, b64) => {
    try {
      // WPBakery uses URL encoding THEN Base64 encoding for raw HTML
      return `[vc_raw_html]${decodeURIComponent(Buffer.from(b64.trim(), "base64").toString())}[/vc_raw_html]`;
    } catch {
      return match;
    }
  });
};

const encodeWpCode = (code: string) => {
  if (!code) return code;
  return code.replace(/\[vc_raw_html\](.*?)\[\/vc_raw_html\]/gs, (match, htmlContent) => {
    try {
      return `[vc_raw_html]${Buffer.from(encodeURIComponent(htmlContent.trim())).toString("base64")}[/vc_raw_html]`;
    } catch {
      return match;
    }
  });
};

// AI Generation Route
apiRouter.post("/generate", async (req, res) => {
  const { blockCode, writingInstructions, replacementContent, builderType, mode, engine = 'gemini', model, rewriteContent, globalButtonText } = req.body;

  const shouldRewrite = rewriteContent !== false; // Defaults to true
  const decodedBlockCode = decodeWpCode(blockCode);

  if (!blockCode || !writingInstructions || !builderType) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  let resolvedEngine = engine;
  const activeModel = model || "gemini-3.5-flash";
  if (activeModel.startsWith("llama") || activeModel.startsWith("meta-llama") || activeModel.startsWith("mixtral") || activeModel.startsWith("gemma")) {
    resolvedEngine = "groq";
  }

  try {
    let systemInstruction = `You are an expert Content Migration Specialist and WordPress Architect.
Your absolute priority is to REWRITE the provided TARGET CODE BLOCK using ONLY the facts from the SOURCE REPLACEMENT CONTENT.

CRITICAL TOPIC REPLACEMENT RULE:
- The TARGET CODE BLOCK is just a structural template. You MUST REPLACE ALL text, numbers, and lists from the old topic with the new facts from the SOURCE REPLACEMENT CONTENT. 
- Example: If the block is about "Company Registration" and the new content is about "Trust Establishment", you MUST remove "Company Registration" entirely and use "Trust Establishment" everywhere it is appropriate.

Rules for Content integration:
1. STRICTLY PRESERVE the code architecture. Do NOT modify shortcodes (vc_row, vc_column, etc.), JSON keys, CSS classes, or technical attributes.
2. MAP the "Source Replacement Content" to the existing structural fields. Replace all old human-readable text.
3. ${shouldRewrite ? 'REWRITE the facts from the source content to fit the length and style of the target block. Feel free to rephrase.' : 'Inject the Source Replacement Content exactly as it reads.'}
4. HTML FORMATTING: If generating list items, wrap short descriptors in <strong> tags (e.g., <li><strong>Descriptor</strong> Elaborating sentence</li>).
5. ENCODED RAW HTML: If you encounter a [vc_raw_html] shortcode, the content is already decoded for you in the prompt. Update the readable text within it while preserving structure, then the system will re-encode it.
6. Return ONLY the final raw code. No markdown boxes, no talk.`;

    if (resolvedEngine === 'groq') {
       systemInstruction += `\n\nCRITICAL: DO NOT output binary characters or mojibake.`;
    }

    const promptMessage = `
SOURCE REPLACEMENT CONTENT (FACTS TO USE):
${replacementContent}

TARGET CODE BLOCK TO REWRITE (STRUCTURAL TEMPLATE):
${decodedBlockCode}

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
      // Default to Gemini 3.x models
      const geminiModel = activeModel === "gemini-1.5-pro" || activeModel === "gemini-3.1-pro-preview" ? "gemini-3.1-pro-preview" : "gemini-3.5-flash";
      
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

    const finalResult = encodeWpCode(cleanResult(result));
    
    if (finalResult.includes("\uFFFD") || (finalResult.match(/[^\x20-\x7E\s]/g) && (finalResult.match(/[^\x20-\x7E\s]/g)!.length > finalResult.length * 0.2))) {
       throw new Error("GARBAGE_OUTPUT_DETECTED");
    }

    res.json({ result: finalResult });
  } catch (error: any) {
    console.error("AI Error:", error);
    try {
      const fallbackResponse = await (genAI as any).models.generateContent({
         model: "gemini-3.1-pro-preview",
         contents: [{ role: "user", parts: [{ text: `SOURCE REPLACEMENT CONTENT:\n${replacementContent}\n\nTARGET CODE BLOCK:\n${blockCode}` }] }],
         config: {
            systemInstruction: `You are an expert Content Migration Specialist. Rewrite the TARGET CODE BLOCK content using the facts from SOURCE REPLACEMENT CONTENT. Preserve ALL structural code/shortcodes. RETURN ONLY RAW CODE.`,
            temperature: 0.1
         }
      });
      const fallbackResult = fallbackResponse.text || "";
      const cleanedFallback = fallbackResult.replace(/^```[a-z]*\n/gi, "").replace(/\n```$/g, "").trim();
      res.json({ result: encodeWpCode(cleanedFallback) });
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
    const geminiMdl = mdl === "gemini-1.5-flash" ? "gemini-3.5-flash" : mdl;
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
        data = await classifyWithGemini(model || "gemini-1.5-flash");
      }
    } catch (primaryError) {
      console.error("Primary classification failed, falling back to gemini-1.5-flash...", primaryError);
      data = await classifyWithGemini("gemini-1.5-flash");
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
