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

// AI Generation Route
apiRouter.post("/generate", async (req, res) => {
  const { blockCode, writingInstructions, replacementContent, builderType, mode, engine = 'gemini', model } = req.body;

  if (!blockCode || !writingInstructions || !builderType) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const systemInstruction = `You are a professional WordPress content architect and SEO strategist.
    Your core mission is to rewrite the content within the provided WordPress block code while strictly preserving its technical structure and syntax.
    
    BUILDER TYPE: ${builderType}
    MODE: ${mode === 'seo' ? 'High-Performance SEO Optimization' : 'Content Transformation'}
    USER INSTRUCTIONS: ${writingInstructions}
    SOURCE REPLACEMENT CONTENT (HTML): ${replacementContent ? `Use this content to fill the blocks: ${replacementContent}` : 'Rewrite existing content in the blocks.'}

    CRITICAL RULES:
    1. DO NOT change any structural tags, shortcode parameters (like ids, classes, or animation settings), or JSON keys.
    2. ONLY rewrite the human-readable text values found within shortcode content or JSON values.
    3. Use the SOURCE REPLACEMENT CONTENT provided above to replace the content in the block while matching the block's current layout/semantic role. 
    4. For short text or bullet sections, if you use two-column (image/text) layouts, alternate the order automatically (e.g., image-text, then text-image) if placed sequentially.
    5. For SEO mode: Focus on high-value keywords, semantic relevance, and conversion-oriented copy.
    6. For Rewrite mode: Strictly follow the user's tone and style requirements.
    7. RETURN ONLY THE RAW CODE. No markdown boxes, no preambles, no explanations.
    8. Ensure all escaping is preserved (e.g., if text is inside a JSON string, ensure quotes are escaped correctly).`;

    const prompt = `Rewrite this section code block:\n\n${blockCode}`;

    let result = "";

    if (engine === 'groq' && groq) {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        model: model || "llama-3.3-70b-versatile",
      });
      result = completion.choices[0]?.message?.content || "";
    } else if (engine === 'gemini-pro') {
      const response = await genAI.models.generateContent({
        model: model || "gemini-1.5-pro",
        contents: prompt,
        config: { systemInstruction }
      });
      result = response.text || "";
    } else {
      const response = await genAI.models.generateContent({
        model: model || "gemini-3.5-flash",
        contents: prompt,
        config: { systemInstruction }
      });
      result = response.text || "";
    }

    res.json({ result: result.replace(/^```[a-z]*\n/i, "").replace(/\n```$/m, "") });
  } catch (error: any) {
    console.error("AI Error:", error);
    try {
      console.log("Attempting fallback to gemini-3.5-flash...");
      const fallbackResponse = await genAI.models.generateContent({
         model: "gemini-3.5-flash",
         contents: `Rewrite this section code block:\n\n${blockCode}`,
         config: {
            systemInstruction: `You are a professional WordPress content architect and SEO strategist.\nYour core mission is to rewrite the content within the provided WordPress block code while strictly preserving its technical structure and syntax.\nBUILDER TYPE: ${builderType}\nMODE: ${mode === 'seo' ? 'High-Performance SEO Optimization' : 'Content Transformation'}\nUSER INSTRUCTIONS: ${writingInstructions}\nSOURCE REPLACEMENT CONTENT (HTML): ${replacementContent ? 'Use this content to fill the blocks: ' + replacementContent : 'Rewrite existing content in the blocks.'}\nCRITICAL RULES:\n1. DO NOT change any structural tags, shortcode parameters (like ids, classes, or animation settings), or JSON keys.\n2. ONLY rewrite the human-readable text values found within shortcode content or JSON values.\n3. RETURN ONLY THE RAW CODE.`
         }
      });
      const fallbackResult = fallbackResponse.text || "";
      res.json({ result: fallbackResult.replace(/^```[a-z]*\n/i, "").replace(/\n```$/m, "") });
    } catch (fallbackError: any) {
      res.status(500).json({ error: "All generation models failed: " + error.message });
    }
  }
});

// Auto-Classification Route
apiRouter.post("/classify", async (req, res) => {
  const { blockCode, model } = req.body;
  if (!blockCode) return res.status(400).json({ error: "Missing blockcode" });

  // Determine engine based on model name
  const isGroqModel = model && (model.startsWith("llama") || model.startsWith("mixtral") || model.startsWith("gemma"));

  const systemInstruction = `Role: You are a strict UX/UI Blueprint Architect. Your task is to analyze raw website code (such as WordPress Bakery shortcodes or custom HTML) and classify the section into a generic, industry-standard wireframe component name AND determine its primary structural type.

CRITICAL RULE 1: You must *never* use specific brand names, industry keywords, or verbs found in the page text. Do not look at the text "Expert 4x4 Mechanical Repair" and name it "4x4 Repair Layout".
CRITICAL RULE 2: Focus purely on structural intent, content layout, and user-interface conventions.
APPROVED CORE WIREFRAME DICTIONARY:
* Hero Section (The absolute top section of a page; usually features a prominent heading, introductory text, and a primary call-to-action button).
* Services Grid / Features Grid (A multi-column grid layout or card collection used to display offerings, core capabilities, or value pillars).
* Image + Text (A balanced 2-column structural layout with a visual graphic/image on the left and descriptive paragraph text/headings on the right).
* Text + Image (A balanced 2-column structural layout with descriptive paragraph text/headings on the left and a visual graphic/image on the right).
* Trust Bar (A compact horizontal row displaying partner logos, industry certifications, associations, or quick benefit badges).
* Reviews / Testimonials (A dedicated container displaying user quotes, social proof sliders, or embedded third-party review widgets).
* Pricing Grid (Tables, comparative lists, or structured columns showcasing tier lists, package costs, or service pricing models).
* FAQ Section (A layout primarily dedicated to resolving frequent user queries; often utilizing toggle systems, lists, or structural FAQ nodes).
* About Us / Content Block (General layout containing editorial paragraphs, company mission statements, or general overview copy).
* Contact Form / CTA (High-intent conversion areas featuring interactive forms, reservation widgets, input fields, maps, or direct communication callouts).

HANDLING COMPONENT EXTENSIONS & OUTLIERS:
If a section contains a distinct interactive UI pattern or explicit fallback layout not covered natively by the core list above, you are permitted to construct a generic wireframe name by appending or utilizing standard UX terminology. Examples include:
* [Component Name] Slider / [Component Name] Carousel (e.g., Hero Slider, Testimonial Carousel)
* Accordion Section (For stacked interactive disclosure panels containing heavy data or documentation outside of FAQs)
* Tabbed Content Block (For layouts using navigation tabs to swap out visible structural containers)
* Gallery / Portfolio Grid (For layouts showcasing a mosaic or matrix of image/media nodes)
* Process / Steps Flow (For step-by-step numbers, timelines, or linear workflow graphs)

Return a JSON object with strictly these keys:
- "type": classify its primary structural purpose. Choose ONLY from: Hero Section, Call to Action, Services/Features Grid, Pricing Table, Testimonials/Trust Bar, Content/Text Section, Image Gallery, Header/Footer, FAQ/Accordion.
- "name": Using the rules and CORE WIREFRAME DICTIONARY above, output ONLY the final chosen structural name as a clean string. Do not include quotes, periods, introductory filler text, or technical explanations.
- "textPreview": extract a short snippet (max 100 chars) of the most prominent readable text in the block.
- "cleanHtml": Extract ONLY the pure HTML tags and readable text. Remove ALL shortcodes, JSON config, and wrappers. Return basic HTML like <h1>...</h1><p>...</p>.

Code:
${blockCode.substring(0, 3500)}`;

  const classifyWithGemini = async (mdl: string) => {
    const resp = await (genAI as any).models.generateContent({
      model: mdl,
      contents: systemInstruction,
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
        data = await classifyWithGroq(model);
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
