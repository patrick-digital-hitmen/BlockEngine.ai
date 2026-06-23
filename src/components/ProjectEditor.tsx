import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { Project, Block, GenerationState, Page } from '../types';
import { 
  ArrowLeft, Plus, Play, Save, Trash2, Copy, 
  MoveUp, MoveDown, FileCode, CheckCircle2, 
  AlertCircle, Loader2, Wand2, Download, Eye, FileText, Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ThreadEditor } from './ThreadEditor';
import { mapBlocksToSourceSections } from '../lib/contentMapping';

function BlockNameInput({ db, projectId, block, index }: { db: any, projectId: string, block: Block, index: number }) {
  const [name, setName] = React.useState(block.name || `Section ${index + 1}`);

  React.useEffect(() => {
    setName(block.name || `Section ${index + 1}`);
  }, [block.name, index]);

  return (
    <input 
      type="text"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={(e) => updateDoc(doc(db, `projects/${projectId}/blocks`, block.id), { name: e.target.value })}
      className="font-bold text-slate-800 text-sm bg-transparent border border-transparent focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 px-1.5 py-0.5 -ml-1.5 rounded outline-none w-48 transition-all"
    />
  );
}

const extractBasicLayout = (code: string, builderType: string): string => {
  try {
    if (builderType === 'wp-bakery') {
      const colRegex = /\[(?:vc_column|vc_column_inner)\b([^\]]*)\]/g;
      const colMatches = [...code.matchAll(colRegex)];
      let colsStr = '';
      if (colMatches.length > 0) {
        let widths = colMatches.map(m => {
          const w = m[1].match(/width=["']([^"']+)["']/);
          return w ? w[1] : '1/1';
        });
        colsStr = `${widths.length} cols (${widths.join(' | ')})`;
      }

      const rowMatch = code.match(/\[(?:vc_row|vc_section)\b([^\]]*)\]/);
      let extras = [];
      if (rowMatch) {
         if (rowMatch[1].includes('video_bg="yes"')) extras.push('bg: video');
         else if (rowMatch[1].match(/bg_image=["']/)) extras.push('bg: img');
         else if (rowMatch[1].match(/bg_color=["']/)) extras.push('bg: color');
         if (rowMatch[1].match(/css=["'][^"']*padding[^"']*["']/)) extras.push('pad: custom');
      }

      if (colsStr || extras.length > 0) {
        return [colsStr, ...extras].filter(Boolean).join(' • ');
      }
    } else if (builderType === 'gutenberg-acf') {
      const coreColumns = [...code.matchAll(/<!-- wp:column\b/g)];
      if (coreColumns.length > 0) {
        return `${coreColumns.length} cols`;
      }
    }
  } catch(e) {}
  return '';
};

interface ProjectEditorProps {
  project: Project;
  onBack: () => void;
}

const decodeWpCode = (code: string) => {
  if (!code) return code;
  return code.replace(/\[vc_raw_html([^\]]*)\](.*?)\[\/vc_raw_html\]/gs, (match, attrs, b64) => {
      try {
          return `[vc_raw_html${attrs}]${decodeURIComponent(atob(b64.trim()))}[/vc_raw_html]`;
      } catch {
          return match;
      }
  });
};

const normalizeWpCodeForExport = (code: string) => {
  if (!code) return code;
  return code.replace(/\[vc_raw_html([^\]]*)\](.*?)\[\/vc_raw_html\]/gs, (match, attrs, content) => {
    const trimmed = content.trim();
    try {
      decodeURIComponent(atob(trimmed));
      return match;
    } catch {
      return `[vc_raw_html${attrs}]${btoa(encodeURIComponent(trimmed))}[/vc_raw_html]`;
    }
  });
};

export function ProjectEditor({ project, onBack }: ProjectEditorProps) {
  const [activeTab, setActiveTab] = useState<'threads' | 'library' | 'settings'>('threads');
  const [librarySubTab, setLibrarySubTab] = useState<'components' | 'templates'>('components');
  const [engine, setEngine] = useState<'gemini' | 'gemini-pro' | 'groq'>('gemini');
  const [model, setModel] = useState<string>('');
  const [disableRewrite, setDisableRewrite] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  const [pageTemplates, setPageTemplates] = useState<any[]>([]);
  const [selectedPage, setSelectedPage] = useState<Page | null>(null);
  const [isCreatingPage, setIsCreatingPage] = useState(false);
  const [newPage, setNewPage] = useState({ title: '', replacementContent: '', templateId: '' });

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [isAddingBlock, setIsAddingBlock] = useState(false);
  const [importMode, setImportMode] = useState<'single' | 'page'>('single');
  const [saveAsTemplate, setSaveAsTemplate] = useState(true);
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [newBlock, setNewBlock] = useState({ name: '', originalCode: '', type: 'Content/Text Section', layoutDescription: '', textPreview: '', cleanHtml: '' });
  const [genState, setGenState] = useState<GenerationState>({ isGenerating: false, currentBlockIndex: 0, totalBlocks: 0 });
  const [newBlockView, setNewBlockView] = useState<'code' | 'preview'>('code');
  const [inputModes, setInputModes] = useState<Record<string, 'code' | 'preview'>>({});
  const [isClassifyingBlock, setIsClassifyingBlock] = useState<Record<string, boolean>>({});
  const [previewMode, setPreviewMode] = useState<'original' | 'rewritten' | 'seo'>('rewritten');

  useEffect(() => {
    const q = query(collection(db, `projects/${project.id}/blocks`), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const blocksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Block[];
      setBlocks(blocksData);
    });
    return () => unsubscribe();
  }, [project.id]);

  useEffect(() => {
    const q = query(collection(db, `projects/${project.id}/pages`), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pagesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Page[];
      setPages(pagesData);
    });
    return () => unsubscribe();
  }, [project.id]);

  useEffect(() => {
    const q = query(collection(db, `projects/${project.id}/templates`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const templatesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPageTemplates(templatesData);
    });
    return () => unsubscribe();
  }, [project.id]);

  const handleCreatePage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPage.title || !newPage.replacementContent) return;
    try {
      const pageRef = await addDoc(collection(db, `projects/${project.id}/pages`), {
        title: newPage.title,
        replacementContent: newPage.replacementContent,
        projectId: project.id,
        createdAt: new Date()
      });

      if (newPage.templateId) {
         const template = pageTemplates.find(t => t.id === newPage.templateId);
         if (template && template.blocks) {
            const batch = writeBatch(db);
            const mappedSnippets = mapBlocksToSourceSections(template.blocks, newPage.replacementContent);
            
            template.blocks.forEach((tBlock: any, index: number) => {
               const pBlockRef = doc(collection(db, `projects/${project.id}/pages/${pageRef.id}/pageBlocks`));
               
               const mappedSnippet = mappedSnippets[index] || '';

               batch.set(pBlockRef, {
                 pageId: pageRef.id,
                 projectId: project.id,
                 libraryBlockId: tBlock.id || null,
                 originalCode: tBlock.originalCode || '',
                 mappedHtmlSnippet: mappedSnippet,
                 generatedCode: '',
                 status: 'pending',
                 order: index,
                 isVerbatim: tBlock.isVerbatim || false,
                 name: tBlock.name || `Section ${index + 1}`,
                 type: tBlock.type || 'Content/Text Section'
               });
            });
            await batch.commit();
         }
      }

      setNewPage({ title: '', replacementContent: '', templateId: '' });
      setIsCreatingPage(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleClassifyAll = async () => {
    for (const block of blocks) {
      if (block.name.startsWith('Section') || block.name.startsWith('Component') || block.type === 'Content/Text Section') {
        if (!isClassifyingBlock[block.id]) {
          await handleClassifyBlock(block);
        }
      }
    }
  };

  const [isParsingBatch, setIsParsingBatch] = useState(false);

  const classifyCode = async (blockCode: string) => {
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          blockCode,
          model: localStorage.getItem('classifyModel') || 'llama-3.1-8b-instant'
        })
      });
      return await res.json();
    } catch (e) {
      console.error(e);
      return {};
    }
  };

  const handleClassify = async () => {
    if (!newBlock.originalCode) return;
    try {
      const data = await classifyCode(newBlock.originalCode);
      if (data.type) {
        setNewBlock(prev => ({ 
          ...prev,
          name: prev.name || data.name || '', 
          type: data.type, 
          textPreview: data.textPreview || '',
          cleanHtml: data.cleanHtml || ''
        }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleClassifyBlock = async (block: Block) => {
    setIsClassifyingBlock(prev => ({ ...prev, [block.id]: true }));
    try {
      const data = await classifyCode(block.originalCode);
      if (data.type) {
        await updateDoc(doc(db, `projects/${project.id}/blocks`, block.id), {
          name: typeof data.name === 'string' ? data.name : (block.name || 'Component'),
          type: typeof data.type === 'string' ? data.type : 'Content/Text Section',
          textPreview: typeof data.textPreview === 'string' ? data.textPreview : JSON.stringify(data.textPreview || ''),
          cleanHtml: typeof data.cleanHtml === 'string' ? data.cleanHtml : ''
        });
      }
    } catch (e) {
      console.error('Failed to classify block:', e);
    } finally {
      setIsClassifyingBlock(prev => ({ ...prev, [block.id]: false }));
    }
  };

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlock.originalCode) return;
    
    try {
      setIsParsingBatch(true);
      const batch = writeBatch(db);
      const blocksSource = importMode === 'page' 
        ? splitBlocks(newBlock.originalCode, project.builderType)
        : [newBlock.originalCode];

      const templateBlocks = [];

      for (let i = 0; i < blocksSource.length; i++) {
        const code = blocksSource[i];
        let blockName = importMode === 'page' ? `${newBlock.name || 'Component'} ${i + 1}` : newBlock.name;
        let blockType = newBlock.type;
        let textPreview = '';
        let cleanHtml = '';
        let layoutDesc = importMode === 'page' ? extractBasicLayout(code, project.builderType) : (newBlock.layoutDescription || extractBasicLayout(code, project.builderType));

        // Attempt classification for better template data
        if (importMode === 'page') {
            try {
                const data = await classifyCode(code);
                if (data.name) blockName = data.name;
                if (data.type) blockType = data.type;
                if (data.textPreview) textPreview = data.textPreview;
                if (data.cleanHtml) cleanHtml = data.cleanHtml;
            } catch (e) {
                console.error("Classification failed for block", i, e);
            }
        }

        if (saveToLibrary || importMode === 'single') {
            const blockRef = doc(collection(db, `projects/${project.id}/blocks`));
            batch.set(blockRef, {
              name: blockName,
              originalCode: code,
              type: blockType,
              layoutDescription: layoutDesc,
              textPreview: textPreview || '',
              cleanHtml: cleanHtml || '',
              projectId: project.id,
              order: blocks.length + i,
              content: '',
              seoContent: ''
            });
        }
        
        if (saveAsTemplate && importMode === 'page') {
            templateBlocks.push({
                id: `tmp_${Date.now()}_${i}`,
                originalCode: code,
                type: blockType,
                layoutDescription: layoutDesc,
                name: blockName,
                textPreview: textPreview || '',
                cleanHtml: cleanHtml || ''
            });
        }
      }

      if (saveAsTemplate && importMode === 'page' && templateBlocks.length > 0) {
          const tplRef = doc(collection(db, `projects/${project.id}/templates`));
          batch.set(tplRef, {
              projectId: project.id,
              name: newBlock.name || 'Untitled Template',
              blocks: templateBlocks
          });
      }

      await batch.commit();
      setNewBlock({ name: '', originalCode: '', type: 'Content/Text Section', layoutDescription: '', textPreview: '', cleanHtml: '' });
      setIsAddingBlock(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${project.id}/blocks`);
    } finally {
      setIsParsingBatch(false);
    }
  };

  const splitBlocks = (code: string, builderType: string): string[] => {
    if (builderType === 'wp-bakery') {
      // Prioritize vc_section as a block delimiter if it exists
      if (code.includes('[vc_section')) {
        return code.split(/(?=\[vc_section)/g).map(s => s.trim()).filter(Boolean);
      }
      return code.split(/(?=\[vc_row)/g).map(s => s.trim()).filter(Boolean);
    }
    if (builderType === 'gutenberg-acf') {
      return code.split(/(?=<!-- wp:)/g).map(s => s.trim()).filter(Boolean);
    }
    if (builderType === 'elementor') {
      try {
        const parsed = JSON.parse(code);
        if (Array.isArray(parsed)) return parsed.map(p => JSON.stringify(p, null, 2));
        if (parsed.content && Array.isArray(parsed.content)) {
          return parsed.content.map((p: any) => JSON.stringify(p, null, 2));
        }
      } catch (e) {
        // Fallback or legacy Elementor
      }
    }
    return [code];
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= blocks.length) return;

    const batch = writeBatch(db);
    const block1 = doc(db, `projects/${project.id}/blocks`, blocks[index].id);
    const block2 = doc(db, `projects/${project.id}/blocks`, blocks[newIndex].id);

    batch.update(block1, { order: newIndex });
    batch.update(block2, { order: index });

    await batch.commit();
  };

  const handleDuplicate = async (block: Block) => {
    try {
      const { id, ...data } = block;
      await addDoc(collection(db, `projects/${project.id}/blocks`), {
        ...data,
        name: `${block.name || 'Section'} (Copy)`,
        order: blocks.length
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${project.id}/blocks`);
    }
  };

    const handleGenerate = async (block: Block, mode: 'rewrite' | 'seo') => {
      try {
        if (block.isVerbatim) {
           const blockRef = doc(db, `projects/${project.id}/blocks`, block.id);
           await updateDoc(blockRef, {
             [mode === 'rewrite' ? 'content' : 'seoContent']: block.originalCode
           });
           return;
        }

        const generationModel = model || (mode === 'seo' ? localStorage.getItem('seoModel') || 'gemini-3.1-pro-preview' : localStorage.getItem('generateModel') || 'llama-3.1-8b-instant');
        const isGroqModel = engine === 'groq' || generationModel.startsWith('llama') || generationModel.startsWith('meta-llama') || generationModel.startsWith('mixtral') || generationModel.startsWith('gemma');
        
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blockCode: block.originalCode,
            writingInstructions: project.writingInstructions,
            replacementContent: project.replacementContent || '', // Pass replacement content
            builderType: project.builderType,
            mode: mode,
            engine: engine || (isGroqModel ? 'groq' : 'gemini'),
            model: generationModel,
            rewriteContent: !disableRewrite
          })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        const blockRef = doc(db, `projects/${project.id}/blocks`, block.id);
        await updateDoc(blockRef, {
          [mode === 'rewrite' ? 'content' : 'seoContent']: data.result
        });
      } catch (error: any) {
        console.error("Generation failed:", error);
        alert("Generation failed: " + error.message);
      }
    };

  const handleGenerateAll = async () => {
    if (blocks.length === 0) return;
    setGenState({ isGenerating: true, currentBlockIndex: 0, totalBlocks: blocks.length });

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        setGenState(prev => ({ ...prev, currentBlockIndex: i + 1 }));
        
        if (block.isVerbatim) {
           await handleGenerate(block, 'rewrite');
           continue; 
        }

        if (block.content) continue; // Skip completed

        await handleGenerate(block, 'rewrite');
        // Small delay to prevent rate limit issues
        await new Promise(r => setTimeout(r, 600));
    }

    setGenState(prev => ({ ...prev, isGenerating: false }));
  };

  const handleDownload = () => {
    const combined = blocks.map(b => {
      const code = previewMode === 'original' || b.isVerbatim ? b.originalCode : (previewMode === 'seo' ? b.seoContent || b.originalCode : b.content || b.originalCode);
      return normalizeWpCodeForExport(code);
    }).join('\n\n');
    const blob = new Blob([combined], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}-${previewMode}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (selectedPage) {
    return <ThreadEditor project={project} page={selectedPage} libraryBlocks={blocks} onBack={() => setSelectedPage(null)} />;
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Editor Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">{project.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold uppercase tracking-wider">{project.builderType.replace('-', ' ')}</span>
                <span className="text-slate-300">|</span>
                <span className="text-[10px] text-slate-400 font-medium italic">Architect v1.0</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-xl">
               <button
                 onClick={() => setActiveTab('threads')}
                 className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all ${
                   activeTab === 'threads' ? 'bg-white text-indigo-600 shadow-sleek' : 'text-slate-500 hover:text-slate-700'
                 }`}
               >
                 Page Threads
               </button>
               <button
                 onClick={() => setActiveTab('library')}
                 className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all ${
                   activeTab === 'library' ? 'bg-white text-indigo-600 shadow-sleek' : 'text-slate-500 hover:text-slate-700'
                 }`}
               >
                 Component Library
               </button>
               <button
                 onClick={() => setActiveTab('settings')}
                 className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all ${
                   activeTab === 'settings' ? 'bg-white text-indigo-600 shadow-sleek' : 'text-slate-500 hover:text-slate-700'
                 }`}
               >
                 Project Settings
               </button>
          </div>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 overflow-auto p-8 space-y-6">
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-sleek-lg overflow-hidden"
            >
              <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-xl font-bold text-slate-900">Project Strategy & Configuration</h3>
                <p className="text-sm text-slate-500 mt-1">Configure the global instructions that the AI uses to rewrite blocks across all threads.</p>
              </div>

              <div className="p-8 space-y-8">
                <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Project Name</label>
                    <input 
                        type="text"
                        className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-medium"
                        value={project.name}
                        onChange={(e) => updateDoc(doc(db, 'projects', project.id), { name: e.target.value })}
                    />
                </div>

                <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Global Writing Instructions</label>
                    <p className="text-[11px] text-slate-400 leading-relaxed italic">These instructions are injected into every rewrite prompt. Define tone, style, specific acronyms to avoid, or mandatory formatting rules.</p>
                    <textarea 
                        rows={10}
                        className="w-full px-5 py-4 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all resize-none font-medium leading-relaxed"
                        value={project.writingInstructions}
                        onChange={(e) => updateDoc(doc(db, 'projects', project.id), { writingInstructions: e.target.value })}
                        placeholder="e.g., Tone: Professional yet conversational. SEO: Include primary keyword 'WordPress services'. Formatting: Use bullet points for features..."
                    />
                </div>

                <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Target Page Builder</label>
                    <div className="grid grid-cols-3 gap-4">
                        {(['elementor', 'wp-bakery', 'gutenberg-acf'] as const).map(type => (
                            <button
                                key={type}
                                onClick={() => updateDoc(doc(db, 'projects', project.id), { builderType: type })}
                                className={`px-4 py-3 rounded-2xl border font-bold text-xs transition-all ${
                                    project.builderType === type 
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sleek' 
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                                }`}
                            >
                                {type.replace('-', ' ').toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
              </div>

              <div className="px-8 py-5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2 text-indigo-600">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Settings Sync Enabled</span>
                </div>
                <div className="text-[10px] text-slate-400 italic">Changes are saved automatically to Firestore.</div>
              </div>
            </motion.div>
          </div>
        )}

        {activeTab === 'threads' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-800">Page Threads</h3>
                <p className="text-sm text-slate-500">Create new pages to generate specific HTML replacement content</p>
              </div>
              <button
                onClick={() => setIsCreatingPage(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 transition-all shadow-sleek"
              >
                <Plus className="w-4 h-4" /> New Page
              </button>
            </div>

            {isCreatingPage && (
              <form onSubmit={handleCreatePage} className="bg-white p-6 rounded-2xl border border-indigo-200 shadow-sleek space-y-4">
                <h4 className="font-bold text-slate-800">Create New Thread</h4>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Page Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Target Audience Page - Version B"
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={newPage.title}
                    onChange={(e) => setNewPage({ ...newPage, title: e.target.value })}
                  />
                </div>
                {pageTemplates.length > 0 && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Page Template (Optional)</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                        type="button"
                        onClick={() => setNewPage({ ...newPage, templateId: '' })}
                        className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${newPage.templateId === '' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                    >
                        <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center text-slate-400">
                            <Plus className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-bold text-slate-600">Blank Page</span>
                    </button>
                    {pageTemplates.map(t => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setNewPage({ ...newPage, templateId: t.id })}
                            className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${newPage.templateId === t.id ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                        >
                            <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center text-indigo-500 group-hover:scale-110 transition-transform">
                                <Layers className="w-4 h-4" />
                            </div>
                            <div className="text-center">
                                <p className="text-xs font-bold text-slate-800 truncate max-w-[100px]">{t.name}</p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase">{t.blocks?.length || 0} Sec</p>
                            </div>
                        </button>
                    ))}
                  </div>
                </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Source HTML / Replacement Content</label>
                  <textarea
                    required
                    placeholder="Paste the raw text or raw HTML that will go into the templates..."
                    rows={6}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none font-mono text-[11px]"
                    value={newPage.replacementContent}
                    onChange={(e) => setNewPage({ ...newPage, replacementContent: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="bg-indigo-600 text-white font-bold px-6 py-2 rounded-xl">Create</button>
                  <button type="button" onClick={() => setIsCreatingPage(false)} className="text-slate-500 font-bold px-4 py-2 hover:bg-slate-100 rounded-xl">Cancel</button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
               {pages.map(page => (
                 <div key={page.id} onClick={() => setSelectedPage(page)} className="bg-white border border-slate-200 p-5 rounded-2xl cursor-pointer hover:border-indigo-400 hover:shadow-sleek transition-all group">
                   <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 mb-4 group-hover:scale-110 transition-transform">
                     <FileText className="w-5 h-5" />
                   </div>
                   <h4 className="font-bold text-slate-800 text-lg mb-1">{page.title}</h4>
                   <p className="text-xs text-slate-400 line-clamp-2">{page.replacementContent}</p>
                 </div>
               ))}
               {pages.length === 0 && !isCreatingPage && (
                 <div className="col-span-full py-16 text-center border-2 border-dashed border-slate-200 rounded-3xl">
                    <p className="text-slate-400 font-semibold mb-2">No pages yet</p>
                 </div>
               )}
            </div>
          </div>
        )}

        {activeTab === 'library' && (
          <div className="space-y-6">
            <div className="flex bg-slate-100 p-1.5 rounded-2xl w-fit mb-2 shadow-sm">
              <button
                onClick={() => setLibrarySubTab('components')}
                className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
                  librarySubTab === 'components' ? 'bg-white text-indigo-600 shadow-sleek' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Components
              </button>
              <button
                onClick={() => setLibrarySubTab('templates')}
                className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
                  librarySubTab === 'templates' ? 'bg-white text-indigo-600 shadow-sleek' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Page Templates
              </button>
            </div>

            {librarySubTab === 'components' ? (
              <>
                {/* Library Tools Toolbar */}
            <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-4">
              <div>
                  <h3 className="font-bold text-slate-800">Library Components</h3>
                  <p className="text-xs text-slate-500">Manage components used by your page builder.</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 mr-2 text-[11px] font-semibold text-slate-600 bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm cursor-pointer hover:border-indigo-300 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={disableRewrite} 
                    onChange={e => setDisableRewrite(e.target.checked)} 
                    className="rounded text-indigo-600 focus:ring-indigo-500 w-3 h-3 cursor-pointer" 
                  />
                  Disable AI Rewrite
                </label>
                <button
                  onClick={handleClassifyAll}
                  className="px-4 py-2 bg-indigo-50 text-indigo-600 font-bold text-xs rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-2"
                >
                  <Wand2 className="w-3 h-3" />
                  Auto-Detect Names
                </button>
                <button
                  onClick={handleGenerateAll}
                  disabled={blocks.length === 0 || genState.isGenerating}
                  className="px-4 py-2 bg-indigo-600 font-bold text-xs text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2 shadow-sm"
                >
                  <Play className="w-3 h-3" />
                  {genState.isGenerating ? 'Generating...' : 'Generate All Components'}
                </button>
              </div>
            </div>

            {genState.isGenerating && (
              <div className="bg-indigo-600 text-white rounded-2xl p-4 flex items-center justify-between shadow-sleek-lg sticky top-0 z-10 border border-indigo-400">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-white" />
                  <span className="font-semibold tracking-tight">Architect is at work... Section {genState.currentBlockIndex} of {genState.totalBlocks}</span>
                </div>
                <div className="w-48 bg-indigo-400/30 h-2 rounded-full overflow-hidden">
                    <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(genState.currentBlockIndex / genState.totalBlocks) * 100}%` }}
                        className="h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]"
                    />
                </div>
              </div>
            )}

        <div className="space-y-4">
          <AnimatePresence>
            {blocks.map((block, index) => (
              <motion.div
                key={block.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`bg-white rounded-2xl border transition-all shadow-sleek overflow-hidden group ${
                    genState.isGenerating && genState.currentBlockIndex - 1 === index 
                    ? 'border-indigo-500 border-2 shadow-indigo-100 ring-4 ring-indigo-500/10' 
                    : 'border-slate-200'
                }`}
              >
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-white group-hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => handleMove(index, 'up')} disabled={index === 0} className="text-slate-300 hover:text-indigo-600 disabled:opacity-30 p-0.5"><MoveUp className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleMove(index, 'down')} disabled={index === blocks.length - 1} className="text-slate-300 hover:text-indigo-600 disabled:opacity-30 p-0.5"><MoveDown className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center font-bold text-slate-400 text-xs border border-slate-200 group-hover:bg-white group-hover:text-indigo-500 transition-colors">
                      {index + 1}
                    </div>
                    <div>
                      <BlockNameInput db={db} projectId={project.id} block={block} index={index} />
                      <div className="flex items-center gap-2 mt-0.5">
                        {block.layoutDescription && block.layoutDescription !== "Unknown Layout" && block.layoutDescription !== "Auto-detect failed" ? (
                           <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-[0.1em] truncate max-w-[300px]">{block.layoutDescription}</span>
                        ) : (
                           <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-[0.2em]">{block.type}</span>
                        )}
                        {block.isVerbatim && <span className="text-[9px] font-bold text-emerald-500 bg-emerald-50 px-1 rounded uppercase tracking-[0.1em]">Verbatim</span>}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleClassifyBlock(block)}
                      className={`p-2 rounded-lg transition-all text-xs font-bold ${isClassifyingBlock[block.id] ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                      title="Auto-Name & Classify"
                      disabled={isClassifyingBlock[block.id]}
                    >
                      {isClassifyingBlock[block.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={async () => {
                        const updates: any = { isVerbatim: !block.isVerbatim };
                        if (!block.isVerbatim) {
                           updates.content = block.originalCode;
                           updates.seoContent = block.originalCode;
                        }
                        await updateDoc(doc(db, `projects/${project.id}/blocks`, block.id), updates);
                      }}
                      className={`p-2 rounded-lg transition-all text-xs font-bold ${block.isVerbatim ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                      title="Toggle Verbatim (Do not modify code)"
                    >
                      {block.isVerbatim ? 'Verbatim' : 'Set Verbatim'}
                    </button>
                    <button
                      onClick={() => handleDuplicate(block)}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                      title="Duplicate Section"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleGenerate(block, 'rewrite')}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                      title="Regenerate this section"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteDoc(doc(db, `projects/${project.id}/blocks`, block.id))}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex bg-slate-50 border-b border-slate-100">
                  {block.textPreview && (
                    <div className="flex-1 p-3 text-[11px] text-slate-500 italic border-r border-slate-100">
                      <span className="font-semibold not-italic text-slate-600 mr-2">Preview:</span>
                      "{block.textPreview}"
                    </div>
                  )}
                </div>
                <div className="flex h-64 overflow-hidden divide-x divide-slate-100">
                  <div className="flex-1 flex flex-col">
                    <div className="px-4 py-2 bg-slate-100/50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span>Input Source</span>
                        <div className="flex bg-slate-200/80 p-0.5 rounded-lg">
                          <button 
                            type="button" 
                            onClick={() => setInputModes(prev => ({...prev, [block.id]: 'code'}))}
                            className={`px-2 py-1 rounded-md transition-all ${inputModes[block.id] !== 'preview' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                          >Code</button>
                          <button 
                            type="button" 
                            onClick={() => setInputModes(prev => ({...prev, [block.id]: 'preview'}))}
                            className={`px-2 py-1 rounded-md transition-all ${inputModes[block.id] === 'preview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                          >Preview</button>
                        </div>
                      </div>
                      <FileCode className="w-3 h-3 text-slate-400" />
                    </div>
                    {inputModes[block.id] === 'preview' ? (
                       <div className="flex-1 p-4 bg-white overflow-auto prose prose-sm max-w-none prose-slate">
                           {block.cleanHtml ? (
                               <div dangerouslySetInnerHTML={{ __html: block.cleanHtml }} />
                           ) : (
                               <div className="text-slate-600 whitespace-pre-wrap">{block.originalCode.replace(/\[\/?.*?\]/g, ' ')}</div>
                           )}
                       </div>
                    ) : (
                       <pre className="flex-1 p-4 bg-slate-900 text-indigo-400/80 font-mono text-[11px] overflow-auto whitespace-pre-wrap leading-relaxed selection:bg-indigo-500/30">
                         {block.originalCode}
                       </pre>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col bg-white">
                    <div className="px-4 py-2 bg-white border-b border-slate-100 text-[10px] font-bold text-indigo-500 uppercase tracking-widest flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{previewMode === 'rewritten' ? 'Output: SEO Optimized' : previewMode === 'seo' ? 'Output: Variation' : 'Input Preview'}</span>
                        <select 
                          className="bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-[9px] font-medium text-slate-500 outline-none hover:border-indigo-300 transition-colors"
                          value={engine}
                          onChange={(e) => {
                            const val = e.target.value as 'gemini' | 'gemini-pro' | 'groq';
                            setEngine(val);
                            if (val === 'groq' && !model) {
                              setModel('llama-3.3-70b-versatile');
                            } else if (val !== 'groq') {
                              setModel('');
                            }
                          }}
                        >
                          <option value="gemini">Gemini Flash</option>
                          <option value="gemini-pro">Gemini Pro</option>
                          <option value="groq">Groq</option>
                        </select>
                        {engine === 'groq' && (
                          <select 
                            className="bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-[9px] font-medium text-slate-500 outline-none hover:border-indigo-300 transition-colors"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                          >
                            <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
                            <option value="llama-3.1-70b-versatile">Llama 3.1 70B</option>
                            <option value="llama-3.1-8b-instant">Llama 3.1 8B (Instant)</option>
                            <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                            <option value="gemma2-9b-it">Gemma 2 9B</option>
                          </select>
                        )}
                      </div>
                      {((previewMode === 'rewritten' && block.content) || (previewMode === 'seo' && block.seoContent)) ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />}
                    </div>
                    <div className="flex-1 p-4 bg-white overflow-auto relative font-mono text-[11px] whitespace-pre-wrap leading-relaxed text-slate-600">
                       {previewMode === 'original' && block.originalCode}
                       {previewMode === 'rewritten' && (block.content || <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 italic">
                           <Loader2 className={`w-4 h-4 ${genState.isGenerating && genState.currentBlockIndex - 1 === index ? 'animate-spin text-indigo-500' : 'hidden'}`} />
                           <span>Waiting for generation...</span>
                       </div>)}
                       {previewMode === 'seo' && (block.seoContent || <div className="flex items-center justify-center h-full gap-2 text-slate-400 italic">No variation generated</div>)}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isAddingBlock ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white border-2 border-dashed border-indigo-200 rounded-3xl p-8 shadow-sleek"
            >
              <form onSubmit={handleAddBlock} className="space-y-6">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                            <Plus className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900">Map New {importMode === 'page' ? 'Page' : 'Section'}</h3>
                            <p className="text-sm text-slate-500">
                                {importMode === 'page' ? 'Import entire page structure for batch processing' : 'Paste your page builder raw content'}
                            </p>
                        </div>
                    </div>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setImportMode('single')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          importMode === 'single' ? 'bg-white text-indigo-600 shadow-sleek' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Single Section
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportMode('page')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          importMode === 'page' ? 'bg-white text-indigo-600 shadow-sleek' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Whole Page
                      </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Internal Ref Name</label>
                        <input
                            type="text"
                            placeholder="e.g., Hero Background Slider"
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            value={newBlock.name}
                            onChange={e => setNewBlock({...newBlock, name: e.target.value})}
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Block Classification</label>
                          <button type="button" onClick={handleClassify} className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-bold hover:bg-indigo-100 transition-colors">
                              Auto-Detect
                          </button>
                        </div>
                        <select
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                            value={newBlock.type}
                            onChange={e => setNewBlock({...newBlock, type: e.target.value})}
                        >
                            <option>Content/Text Section</option>
                            <option>Hero Section</option>
                            <option>Call to Action</option>
                            <option>Services/Features Grid</option>
                            <option>Pricing Table</option>
                            <option>Testimonials/Trust Bar</option>
                            <option>Image Gallery</option>
                            <option>Header/Footer</option>
                            <option>FAQ/Accordion</option>
                        </select>
                    </div>
                </div>

                {importMode === 'page' && (
                  <div className="flex flex-col gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                     <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Save Options</p>
                     <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                           type="checkbox" 
                           checked={saveToLibrary} 
                           onChange={e => setSaveToLibrary(e.target.checked)}
                           className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                        />
                        <span className="text-sm font-semibold text-slate-700 group-hover:text-indigo-600 transition-colors">Add all sections to Architect Library</span>
                     </label>
                     <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                           type="checkbox" 
                           checked={saveAsTemplate} 
                           onChange={e => setSaveAsTemplate(e.target.checked)}
                           className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                        />
                        <span className="text-sm font-semibold text-slate-700 group-hover:text-indigo-600 transition-colors">Save page layout as a Reusable Template</span>
                     </label>
                  </div>
                )}

                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                            {importMode === 'page' ? 'Full Page Source Code' : 'WP Code Source'}
                        </label>
                        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                            <button 
                                type="button"
                                onClick={() => setNewBlockView('code')}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${newBlockView === 'code' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >Code</button>
                            <button 
                                type="button"
                                onClick={() => setNewBlockView('preview')}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${newBlockView === 'preview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >Preview</button>
                        </div>
                    </div>
                    {newBlockView === 'code' ? (
                        <textarea
                            autoFocus
                            placeholder={importMode === 'page' ? "Paste entire page JSON or shortcodes here..." : "Paste WP Bakery, Elementor, or Gutenberg/ACF code segments..."}
                            rows={12}
                            className="w-full p-4 bg-slate-900 text-indigo-400/90 font-mono text-[11px] rounded-2xl border-none focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all resize-none shadow-inner"
                            value={newBlock.originalCode}
                            onChange={e => setNewBlock({...newBlock, originalCode: decodeWpCode(e.target.value)})}
                        />
                    ) : (
                        <div 
                            className="w-full h-48 p-4 bg-white border border-slate-200 rounded-2xl overflow-auto shadow-inner prose prose-sm max-w-none prose-slate" 
                        >
                            {newBlock.cleanHtml ? (
                                <div dangerouslySetInnerHTML={{ __html: newBlock.cleanHtml }} />
                            ) : (
                                <div className="text-slate-600 whitespace-pre-wrap">{newBlock.originalCode ? newBlock.originalCode.replace(/\[\/?.*?\]/g, ' ') : <span className="text-slate-400 italic">No HTML available.</span>}</div>
                            )}
                        </div>
                    )}
                    {(newBlock.layoutDescription || newBlock.textPreview) && (
                      <div className="mt-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 flex flex-col gap-2">
                         <div className="text-[11px]"><span className="font-bold text-indigo-700">Detected Layout:</span> <span className="text-slate-600">{newBlock.layoutDescription}</span></div>
                         <div className="text-[11px]"><span className="font-bold text-indigo-700">Preview Content:</span> <span className="text-slate-600 italic">"{newBlock.textPreview}"</span></div>
                      </div>
                    )}
                </div>

                <div className="flex gap-3 justify-end items-center">
                    <button
                        type="button"
                        onClick={() => setIsAddingBlock(false)}
                        className="px-6 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition-all"
                    >
                        Discard
                    </button>
                    <button
                        type="submit"
                        disabled={!newBlock.originalCode || isParsingBatch}
                        className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold rounded-xl shadow-sleek transition-all flex items-center gap-2"
                    >
                        {isParsingBatch ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Parsing & Classifying...
                            </>
                        ) : (
                            <>
                                <Plus className="w-5 h-5" />
                                Add to Stack
                            </>
                        )}
                    </button>
                </div>
              </form>
            </motion.div>
          ) : (
            <button
              onClick={() => setIsAddingBlock(true)}
              className="w-full py-12 border-2 border-dashed border-slate-200 rounded-3xl text-slate-400 hover:text-indigo-500 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all flex flex-col items-center justify-center gap-3 font-bold group"
            >
              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center border border-slate-100 shadow-sleek transition-all group-hover:scale-110">
                <Plus className="w-6 h-6 text-slate-300 group-hover:text-indigo-500" />
              </div>
              Map New Component
            </button>
          )}

          {blocks.length === 0 && !isAddingBlock && (
            <div className="py-20 text-center">
                <div className="mx-auto w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 text-slate-300 border border-slate-200">
                    <AlertCircle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Stack is empty</h3>
                <p className="text-slate-500 max-w-sm mx-auto mt-2">Start by mapping your page builder blocks. Architect will automatically detect content fields for optimization.</p>
            </div>
          )}
          </div>
              </>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence>
                    {pageTemplates.map(template => (
                        <motion.div
                            key={template.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-3xl border border-slate-200 shadow-sleek overflow-hidden group hover:border-indigo-400 hover:shadow-sleek-lg transition-all flex flex-col"
                        >
                            <div className="p-6 border-b border-slate-50 relative">
                                <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 mb-4 group-hover:scale-110 transition-transform">
                                    <Layers className="w-6 h-6" />
                                </div>
                                <h4 className="font-bold text-slate-800 text-lg leading-tight">{template.name}</h4>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">{template.blocks?.length || 0} Architect Sections</p>
                                
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Delete this page template?')) {
                                            deleteDoc(doc(db, `projects/${project.id}/templates`, template.id));
                                        }
                                    }}
                                    className="absolute top-6 right-6 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="p-5 bg-slate-50/50 flex-1 space-y-3">
                                <div className="space-y-2">
                                    {template.blocks?.slice(0, 5).map((b: any, i: number) => (
                                        <div key={i} className="flex items-start gap-3 p-2 bg-white/60 rounded-xl border border-white shadow-sm">
                                            <div className="w-5 h-5 bg-indigo-100 rounded-lg flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0">
                                                {i + 1}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[11px] font-bold text-slate-700 truncate">{b.name}</p>
                                                <p className="text-[9px] text-slate-400 font-medium truncate italic">{b.type}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {template.blocks?.length > 5 && (
                                        <div className="text-center py-1">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">+ {template.blocks.length - 5} more sections</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="p-5 bg-white border-t border-slate-100">
                                <button
                                    onClick={() => {
                                        setNewPage({ title: `New ${template.name}`, replacementContent: '', templateId: template.id });
                                        setIsCreatingPage(true);
                                    }}
                                    className="w-full py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    Use Template
                                </button>
                            </div>
                        </motion.div>
                    ))}
                    {pageTemplates.length === 0 && (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-400 gap-4 bg-white rounded-3xl border-2 border-dashed border-slate-100">
                            <div className="mx-auto w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 text-indigo-200 border border-slate-100 shadow-inner">
                                <Layers className="w-8 h-8" />
                            </div>
                            <div className="text-center">
                                <p className="font-bold text-slate-600">No Page Templates Saved</p>
                                <p className="text-xs text-slate-400 mt-1">Check "Save as Page Template" when importing a full page.</p>
                            </div>
                        </div>
                    )}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
