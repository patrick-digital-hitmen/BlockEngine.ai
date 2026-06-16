import React from 'react';
import { X, Save, ShieldAlert, Zap, BrainCircuit } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [classifyModel, setClassifyModel] = React.useState(localStorage.getItem('classifyModel') || 'gemini-3.5-flash');
  const [generateModel, setGenerateModel] = React.useState(localStorage.getItem('generateModel') || 'gemini-3.5-flash');
  const [seoModel, setSeoModel] = React.useState(localStorage.getItem('seoModel') || 'gemini-2.5-pro');

  const handleSave = () => {
    localStorage.setItem('classifyModel', classifyModel);
    localStorage.setItem('generateModel', generateModel);
    localStorage.setItem('seoModel', seoModel);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-3xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col"
        >
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white text-slate-800">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <BrainCircuit className="w-6 h-6 text-indigo-500" />
              AI Model Configuration
            </h2>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
          
          <div className="p-6 overflow-y-auto space-y-8 bg-slate-50">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-500" />
                    Classification Engine
                  </h3>
                  <p className="text-sm text-slate-500">Used for structural parsing and naming. Low creativity needed.</p>
                </div>
              </div>
              <select 
                value={classifyModel}
                onChange={e => setClassifyModel(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="gemini-3.5-flash">Gemini 3.5 Flash (Recommended: Fast & Cheap)</option>
                <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash Exp (Experimental)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (Too expensive for simple tasks)</option>
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Via Groq - Super Fast)</option>
              </select>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-indigo-500" />
                    Generation & Rewrite Engine
                  </h3>
                  <p className="text-sm text-slate-500">Used to rewrite HTML/shortcodes based on user rules.</p>
                </div>
              </div>
              <select 
                value={generateModel}
                onChange={e => setGenerateModel(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="gemini-3.5-flash">Gemini 3.5 Flash (Good balance)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Powerful but slower)</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (Recommended: High Quality)</option>
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Via Groq - Super Fast)</option>
                <option value="mixtral-8x7b-32768">Mixtral 8x7B (Via Groq - High throughput)</option>
              </select>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                    SEO Generation Engine
                  </h3>
                  <p className="text-sm text-slate-500">Requires high reasoning logic for semantic keywords.</p>
                </div>
              </div>
              <select 
                value={seoModel}
                onChange={e => setSeoModel(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (Recommended: Best SEO Copy)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Via Groq)</option>
                <option value="mixtral-8x7b-32768">Mixtral 8x7B (Via Groq)</option>
              </select>
            </div>
            
            <div className="bg-indigo-50 p-4 rounded-xl text-sm text-indigo-800 border border-indigo-100 flex items-start gap-3">
              <Zap className="w-5 h-5 shrink-0 mt-0.5" />
              <p><strong>Pro Tip:</strong> Page Builder layouts contain extremely heavy token payloads (often 4,000+ per section). Using premium models like Gemini 2.5 Pro for classification will drain quotas fast. Stick to Flash for classification.</p>
            </div>
          </div>

          <div className="px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 rounded-b-3xl">
            <button
              onClick={onClose}
              className="px-6 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-sleek transition-all flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Configurations
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
