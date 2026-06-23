# BlockEngine.ai

BlockEngine.ai is a React + Firebase app for rewriting and repurposing WordPress page-builder sections with AI while preserving the original builder structure.

It is designed for content migration workflows where a source page or content brief needs to be mapped into reusable Elementor, WPBakery, or Gutenberg/ACF blocks.

## Features

- Google sign-in with Firebase Auth
- Project-based component libraries
- Page threads that map source HTML/content into saved builder sections
- AI generation through Gemini or Groq-backed Llama models
- WPBakery raw HTML decode/re-encode support on generation
- Firestore security rules scoped by project ownership

## Prerequisites

- Node.js 20+
- A Firebase project with Google Auth and Firestore enabled
- A Gemini API key
- Optional: a Groq API key for Llama models

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from the example:

   ```bash
   cp .env.example .env.local
   ```

3. Set your local secrets:

   ```bash
   GEMINI_API_KEY="your-gemini-api-key"
   GROQ_API_KEY="your-groq-api-key"
   ```

4. Confirm `firebase-applet-config.json` points at the Firebase project and Firestore database you want to use.

5. Start the app:

   ```bash
   npm run dev
   ```

The local server runs at `http://localhost:3000`.

## Scripts

- `npm run dev` starts the Express + Vite development server.
- `npm run build` builds the Vite client and bundles the Node server.
- `npm start` runs the built server from `dist/server.cjs`.
- `npm run lint` runs TypeScript with `--noEmit`.

## Deployment Notes

The repo includes `vercel.json` and `api/index.ts` for Vercel-style API routing. Configure these environment variables in production:

- `GEMINI_API_KEY`
- `GROQ_API_KEY` if Groq models are enabled
- `APP_URL` for the deployed app URL

Review and deploy `firestore.rules` before allowing real user data.
