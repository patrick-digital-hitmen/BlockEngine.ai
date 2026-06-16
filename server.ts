import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import * as admin from "firebase-admin";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
// Note: In AI Studio, we don't always have a service account key file for Admin SDK
// but we can often use the default credentials or just the client SDK on the server if needed.
// However, using the client SDK on the server is possible too.
// For now, let's assume we can use the environment variables or just mock the admin logic if it fails.
// Actually, I'll use the client SDK on the backend to keep it simple and consistent with the config.
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

// Initialize Gemini
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: { headers: { "User-Agent": "aistudio-build" } }
});

// Initialize Groq (Optional, only if user provides key)
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

async function startServer() {
  const app = express();
  app.use(express.json());

  const PORT = 3000;

  // AI Generation Route
  app.post("/api/generate", async (req, res) => {
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
  app.post("/api/classify", async (req, res) => {
    const { blockCode, model } = req.body;
    if (!blockCode) return res.status(400).json({ error: "Missing blockcode" });

    // Determine engine based on model name
    const isGroqModel = model && (model.startsWith("llama") || model.startsWith("mixtral") || model.startsWith("gemma"));

    const systemInstruction = `Analyze this WordPress/HTML content block.
    Return a JSON object with strictly these keys:
    - "type": classify its primary structural purpose. Choose ONLY from: Hero Section, Call to Action, Services/Features Grid, Pricing Table, Testimonials/Trust Bar, Content/Text Section, Image Gallery, Header/Footer, FAQ/Accordion.
    - "name": Suggest a wireframe-style component name based on its content (e.g., "Hero", "Image + Text", "Text + Image", "Trust Bar", "Footer Form", "FAQ", "About Us", "Reviews"). Max 4 words.
    - "layout": describe the structural layout briefly, specifically listing: number of columns, their distribution (e.g. 50/50, 1/3+2/3), the section padding, and background colour. Example: "2 columns (50/50) | Pad: 40px | bg: #f5f5f5".
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
        layout: data.layout || "Unknown Layout",
        textPreview: data.textPreview || "",
        cleanHtml: data.cleanHtml || ""
      });
    } catch (e: any) {
      console.error(e);
      res.json({ type: "Content/Text Section", name: "Component", layout: "Auto-detect failed", textPreview: "", cleanHtml: "" }); // Fallback
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
