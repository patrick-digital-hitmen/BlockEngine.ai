export type BuilderType = 'wp-bakery' | 'elementor' | 'gutenberg-acf';

export interface Project {
  id: string;
  name: string;
  writingInstructions: string;
  builderType: BuilderType;
  createdAt: any;
  ownerId: string;
  replacementContent?: string;
}

export interface Block {
  id: string;
  name: string; // Internal name for reference
  originalCode: string;
  content: string; // The "current" version of rewritten code
  seoContent: string; // SEO optimized variation
  order: number;
  type: string; // e.g. "Header", "Text Section", "Pricing Table"
  projectId: string;
  isVerbatim?: boolean;
  layoutDescription?: string;
  textPreview?: string;
  cleanHtml?: string;
}

export interface Page {
  id: string;
  projectId: string;
  title: string;
  replacementContent?: string;
  globalButtonText?: string;
  createdAt: any;
}

export interface PageBlock {
  id: string;
  pageId: string;
  projectId: string;
  libraryBlockId: string | null;
  originalCode: string;
  mappedHtmlSnippet: string;
  generatedCode: string;
  generatedInputHash?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  order: number;
  isVerbatim: boolean;
  name: string;
  type: string;
}

export interface PageTemplate {
  id: string;
  projectId: string;
  name: string;
  blocks: {
    originalCode: string;
    type: string;
    layoutDescription: string;
    name: string;
  }[];
}

export interface GenerationState {
  isGenerating: boolean;
  currentBlockIndex: number;
  totalBlocks: number;
  error?: string;
}
