import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, doc, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { Project, Block, Page, PageBlock } from '../types';
import { ArrowLeft, Play, Download, Loader2, Plus, GripVertical, CheckCircle2, Trash2, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const splitHtmlByH2 = (html: string) => {
  if (!html) return [];
  const marked = html.replace(/(<h2[\s>])/gi, '---H2_SPLIT---$1');
  const parts = marked.split('---H2_SPLIT---');
  return parts.filter(p => p.trim().length > 0);
};

interface ThreadEditorProps {
  project: Project;
  page: Page;
  libraryBlocks: Block[];
  onBack: () => void;
}

export function ThreadEditor({ project, page, libraryBlocks, onBack }: ThreadEditorProps) {
  const [pageBlocks, setPageBlocks] = useState<PageBlock[]>([]);
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [engine, setEngine] = useState<'gemini' | 'gemini-pro' | 'groq'>('gemini');

  useEffect(() => {
    const q = query(collection(db, `projects/${project.id}/pages/${page.id}/pageBlocks`), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPageBlocks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PageBlock[]);
    });
    return () => unsubscribe();
  }, [project.id, page.id]);

  const handleAddSection = async () => {
    if (!selectedLibraryId) return;
    const libBlock = libraryBlocks.find(b => b.id === selectedLibraryId);
    if (!libBlock) return;

    try {
      await addDoc(collection(db, `projects/${project.id}/pages/${page.id}/pageBlocks`), {
        pageId: page.id,
        projectId: project.id,
        libraryBlockId: libBlock.id,
        originalCode: libBlock.originalCode,
        mappedHtmlSnippet: '', // the specific part of replacementContent to use... or the whole thing? For now we pass the thread html
        generatedCode: '',
        status: 'pending',
        order: pageBlocks.length,
        isVerbatim: libBlock.isVerbatim || false,
        name: libBlock.name,
        type: libBlock.type
      });
      setIsAddingSection(false);
      setSelectedLibraryId('');
    } catch (error) {
      console.error(error);
    }
  };

  const handleAutoMap = async () => {
    try {
      setIsGeneratingAll(true); // just use for loading state
      const sections = splitHtmlByH2(page.replacementContent || '');
      const batch = writeBatch(db);
      
      // Clear existing pageBlocks
      pageBlocks.forEach(b => {
         batch.delete(doc(db, `projects/${project.id}/pages/${page.id}/pageBlocks`, b.id));
      });

      sections.forEach((sectionHtml, i) => {
         const libBlock = i < libraryBlocks.length ? libraryBlocks[i] : null;
         const newRef = doc(collection(db, `projects/${project.id}/pages/${page.id}/pageBlocks`));
         batch.set(newRef, {
          pageId: page.id,
          projectId: project.id,
          libraryBlockId: libBlock?.id || null,
          originalCode: libBlock?.originalCode || '',
          mappedHtmlSnippet: sectionHtml, // Pass the parsed HTML block
          generatedCode: '',
          status: 'pending',
          order: i,
          isVerbatim: libBlock?.isVerbatim || false,
          name: libBlock?.name || `Section ${i + 1}`,
          type: libBlock?.type || 'Content/Text Section'
         });
      });
      
      await batch.commit();
      setIsGeneratingAll(false);
    } catch (e) {
      console.error("Auto Map Error: ", e);
      setIsGeneratingAll(false);
    }
  };

  const handleChangeLibraryBlock = async (pBlockId: string, libBlockId: string) => {
    const libBlock = libraryBlocks.find(b => b.id === libBlockId);
    if (!libBlock) return;
    
    await updateDoc(doc(db, `projects/${project.id}/pages/${page.id}/pageBlocks`, pBlockId), {
      libraryBlockId: libBlock.id,
      originalCode: libBlock.originalCode,
      isVerbatim: libBlock.isVerbatim || false,
      name: libBlock.name,
      type: libBlock.type,
      status: 'pending',
      generatedCode: ''
    });
  };

  const handleGenerate = async (pBlock: PageBlock) => {
    try {
      const blockRef = doc(db, `projects/${project.id}/pages/${page.id}/pageBlocks`, pBlock.id);
      await updateDoc(blockRef, { status: 'generating' });

      if (pBlock.isVerbatim) {
        await updateDoc(blockRef, { generatedCode: pBlock.originalCode, status: 'completed' });
        return;
      }

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blockCode: pBlock.originalCode,
          writingInstructions: project.writingInstructions,
          replacementContent: pBlock.mappedHtmlSnippet || page.replacementContent || '', 
          builderType: project.builderType,
          mode: 'rewrite', // Defaults to rewrite in threads
          engine: engine
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      await updateDoc(blockRef, { generatedCode: data.result, status: 'completed' });
    } catch (error: any) {
      console.error("Generation failed:", error);
      const blockRef = doc(db, `projects/${project.id}/pages/${page.id}/pageBlocks`, pBlock.id);
      await updateDoc(blockRef, { status: 'failed' });
      alert("Generation failed: " + error.message);
    }
  };

  const handleGenerateAll = async () => {
    setIsGeneratingAll(true);
    for (const block of pageBlocks) {
      if (block.status !== 'completed' || block.isVerbatim) {
        await handleGenerate(block);
      }
    }
    setIsGeneratingAll(false);
  };

  const handleDownload = () => {
    const combined = pageBlocks.map(b => b.generatedCode || b.originalCode).join('\n\n');
    const blob = new Blob([combined], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}-${page.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRemove = async (blockId: string) => {
    await deleteDoc(doc(db, `projects/${project.id}/pages/${page.id}/pageBlocks`, blockId));
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-900 leading-tight">{page.title}</h2>
            <div className="text-[11px] text-slate-500">Thread for {project.name}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <select 
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium text-slate-600 outline-none hover:border-indigo-300 transition-colors"
            value={engine}
            onChange={(e) => setEngine(e.target.value as 'gemini' | 'gemini-pro' | 'groq')}
          >
            <option value="gemini">Gemini 3.5 Flash</option>
            <option value="gemini-pro">Gemini 1.5 Pro</option>
            <option value="groq">Groq Llama-3</option>
          </select>

          <button
            onClick={handleGenerateAll}
            disabled={pageBlocks.length === 0 || isGeneratingAll}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-xl flex items-center gap-2 transition-all shadow-sleek disabled:opacity-50"
          >
            {isGeneratingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            Generate All Content
          </button>

          <button
            onClick={handleDownload}
            disabled={pageBlocks.length === 0}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-2 px-4 rounded-xl flex items-center gap-2 transition-all shadow-sleek"
          >
            <Download className="w-4 h-4" />
            Export Page Builder Code
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Source Content Preview */}
        <div className="w-1/3 min-w-[300px] border-r border-slate-200 bg-white flex flex-col hidden lg:flex">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <h3 className="font-bold text-slate-700 text-sm">Source HTML For This Page</h3>
            <p className="text-[10px] text-slate-400">Content that will be injected into components</p>
          </div>
          <div className="flex-1 p-5 overflow-auto bg-slate-900 text-slate-300 font-mono text-[11px] leading-relaxed relative">
             <div className="absolute top-4 right-4 text-[9px] uppercase tracking-wider font-bold text-slate-500 bg-slate-800 px-2 py-1 rounded">Read-Only</div>
             {page.replacementContent}
          </div>
        </div>

        {/* Builder Area */}
        <div className="flex-1 overflow-auto p-8 relative">
          <div className="max-w-3xl mx-auto space-y-6">
            
            <div className="flex items-center justify-between mb-8">
               <h3 className="text-xl font-bold text-slate-800 tracking-tight">Mapped Sections</h3>
               <div className="flex gap-2">
                 <button 
                    onClick={handleAutoMap}
                    disabled={isGeneratingAll}
                    className="flex items-center gap-2 bg-purple-50 text-purple-700 px-4 py-2 border border-purple-100 font-bold text-sm rounded-xl hover:bg-purple-100 transition-colors disabled:opacity-50"
                  >
                    {isGeneratingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Auto-Map Content
                  </button>
                 <button 
                   onClick={() => setIsAddingSection(true)}
                   className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 border border-indigo-100 font-bold text-sm rounded-xl hover:bg-indigo-100 transition-colors"
                  >
                   <Plus className="w-4 h-4" /> Add Section
                 </button>
               </div>
            </div>

            {isAddingSection && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-white border border-indigo-200 rounded-2xl shadow-sleek relative z-10">
                 <h4 className="font-bold text-slate-800 text-sm mb-3">Select Component From Library</h4>
                 <div className="flex gap-3">
                   <select 
                     className="flex-1 bg-slate-50 border border-slate-200 p-2 text-sm rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                     value={selectedLibraryId}
                     onChange={(e) => setSelectedLibraryId(e.target.value)}
                   >
                     <option value="" disabled>-- Choose a section type --</option>
                     {libraryBlocks.map(b => (
                       <option key={b.id} value={b.id}>{b.name || b.type} {b.isVerbatim ? '(Verbatim)' : ''}</option>
                     ))}
                   </select>
                   <button onClick={handleAddSection} disabled={!selectedLibraryId} className="bg-indigo-600 text-white font-bold text-sm px-6 py-2 rounded-xl disabled:opacity-50">Add</button>
                   <button onClick={() => setIsAddingSection(false)} className="text-slate-400 hover:text-slate-600 px-4 py-2 font-bold text-sm">Cancel</button>
                 </div>
              </motion.div>
            )}

            <div className="space-y-4">
              <AnimatePresence>
                {pageBlocks.map((block, index) => (
                  <motion.div
                    key={block.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sleek overflow-hidden group"
                  >
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                      <div className="flex items-center gap-4">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center font-bold text-slate-400 text-xs">
                          {index + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                             <select 
                               className="font-bold text-slate-800 text-sm bg-transparent border border-transparent focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 rounded outline-none max-w-[200px] truncate"
                               value={block.libraryBlockId || ''}
                               onChange={e => handleChangeLibraryBlock(block.id, e.target.value)}
                             >
                               <option value="" disabled>-- Select Component --</option>
                               {libraryBlocks.map(b => (
                                 <option key={b.id} value={b.id}>{b.name || b.type}</option>
                               ))}
                             </select>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-[0.2em]">{block.type || 'Unmapped'}</span>
                            {block.isVerbatim && <span className="text-[9px] font-bold text-emerald-500 bg-emerald-50 px-1 rounded uppercase tracking-[0.1em]">Verbatim</span>}
                            {block.status === 'completed' && <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1 rounded uppercase tracking-[0.1em]">Generated</span>}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleGenerate(block)}
                          disabled={block.status === 'generating'}
                          className="bg-slate-100 hover:bg-indigo-50 text-indigo-600 font-bold text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-50"
                        >
                          {block.status === 'generating' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          {block.status === 'completed' && !block.isVerbatim ? 'Regenerate' : 'Generate'}
                        </button>
                        <button onClick={() => handleRemove(block.id)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg">
                           <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    
                    {block.mappedHtmlSnippet && (
                      <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Mapped HTML Content</div>
                        <div className="font-mono text-[10px] text-slate-600 max-h-32 overflow-y-auto whitespace-pre-wrap p-3 bg-white border border-slate-200 rounded text-clip">{block.mappedHtmlSnippet.slice(0, 300)}{block.mappedHtmlSnippet.length > 300 ? '...' : ''}</div>
                      </div>
                    )}
                    
                    {block.status === 'completed' && block.generatedCode && (
                       <div className="p-4 bg-indigo-50/30 border-t border-indigo-50 font-mono text-[10px] text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto relative">
                         <div className="absolute top-2 right-2 text-[9px] font-bold text-indigo-400 uppercase tracking-widest bg-white px-2 py-1 rounded shadow-sm">Generated HTML</div>
                         {block.generatedCode}
                       </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            
            {pageBlocks.length === 0 && !isAddingSection && (
               <div className="text-center py-24 px-6 border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                   <div className="w-16 h-16 bg-white shadow-sleek rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-100">
                     <GripVertical className="w-8 h-8 text-slate-300" />
                   </div>
                   <h3 className="text-lg font-bold text-slate-700 mb-2">No Sections Assigned</h3>
                   <p className="text-slate-500 text-sm max-w-sm mx-auto">Click "Add Section To Map" to assign components from your Architect Library to this page thread.</p>
               </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
