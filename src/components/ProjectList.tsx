import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { Project, BuilderType } from '../types';
import { Plus, Folder, Calendar, Trash2, ChevronRight, Loader2, FileText, Settings2, Zap } from 'lucide-react';
import { motion } from 'motion/react';

interface ProjectListProps {
  user: User;
  onSelectProject: (project: Project) => void;
}

export function ProjectList({ user, onSelectProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProject, setEditProject] = useState({
    name: '',
    writingInstructions: '',
    builderType: 'elementor' as BuilderType
  });
  const [newProject, setNewProject] = useState({
    name: '',
    writingInstructions: '',
    builderType: 'elementor' as BuilderType
  });

  useEffect(() => {
    const q = query(
      collection(db, 'projects'),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Project[];
      setProjects(projectsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });

    return () => unsubscribe();
  }, [user.uid]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.name || !newProject.writingInstructions) return;

    try {
      setLoading(true);
      await addDoc(collection(db, 'projects'), {
        ...newProject,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
      setIsCreating(false);
      setNewProject({ name: '', writingInstructions: '', builderType: 'elementor' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProject = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    if (!editProject.name || !editProject.writingInstructions) return;

    try {
      setLoading(true);
      await updateDoc(doc(db, 'projects', id), {
        ...editProject
      });
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${id}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'projects', id));
      setDeletingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${id}`);
    }
  };

  if (loading && projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-4" />
        <p className="text-slate-500">Loading your projects...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-bold text-slate-900 tracking-tight">Your Projects</h2>
          <p className="text-slate-500 mt-1">Manage and optimize your WordPress content</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 px-5 rounded-xl flex items-center gap-2 transition-all shadow-sleek hover:shadow-indigo-100"
        >
          <Plus className="w-5 h-5" />
          New Project
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isCreating && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-6 shadow-sleek-lg border border-indigo-100 flex flex-col gap-4"
          >
            <div className="flex items-center gap-2 text-indigo-600 mb-2">
              <Plus className="w-5 h-5" />
              <h3 className="font-bold">Create New Project</h3>
            </div>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 line-clamp-1">Project Name</label>
                <input
                  autoFocus
                  type="text"
                  placeholder="e.g., Home Page Redesign"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  value={newProject.name}
                  onChange={e => setNewProject({...newProject, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Builder Type</label>
                <select
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  value={newProject.builderType}
                  onChange={e => setNewProject({...newProject, builderType: e.target.value as BuilderType})}
                >
                  <option value="elementor">Elementor</option>
                  <option value="wp-bakery">WP Bakery</option>
                  <option value="gutenberg-acf">Gutenberg/ACF</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Writing Instructions</label>
                <textarea
                  placeholder="Tone, style, SEO keywords..."
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all resize-none"
                  value={newProject.writingInstructions}
                  onChange={e => setNewProject({...newProject, writingInstructions: e.target.value})}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="flex-1 py-2 text-slate-600 font-semibold hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newProject.name || !newProject.writingInstructions}
                  className="flex-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-2 px-4 rounded-lg transition-all shadow-sleek"
                >
                  Create Project
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {projects.map((project) => (
          <motion.div
            layoutId={project.id}
            key={project.id}
            onClick={() => !editingId && onSelectProject(project)}
            className={`group bg-white rounded-2xl p-6 shadow-sleek border transition-all relative overflow-hidden ${editingId === project.id ? 'border-indigo-500 ring-2 ring-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:shadow-indigo-50 cursor-pointer'}`}
          >
            {editingId === project.id ? (
              <form onSubmit={(e) => handleUpdateProject(e, project.id)} className="space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-indigo-600 flex items-center gap-2">
                    <Settings2 className="w-5 h-5" />
                    Edit Project
                  </h3>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Project Name</label>
                  <input
                    autoFocus
                    type="text"
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    value={editProject.name}
                    onChange={e => setEditProject({...editProject, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Builder Type</label>
                  <select
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    value={editProject.builderType}
                    onChange={e => setEditProject({...editProject, builderType: e.target.value as BuilderType})}
                  >
                    <option value="elementor">Elementor</option>
                    <option value="wp-bakery">WP Bakery</option>
                    <option value="gutenberg-acf">Gutenberg/ACF</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Writing Instructions</label>
                  <textarea
                    rows={3}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all resize-none"
                    value={editProject.writingInstructions}
                    onChange={e => setEditProject({...editProject, writingInstructions: e.target.value})}
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditingId(null); }}
                    className="flex-1 py-2 text-slate-600 font-semibold hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg transition-all shadow-sleek"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                    <Folder className="w-6 h-6 text-slate-400 group-hover:text-indigo-500" />
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setEditingId(project.id);
                        setEditProject({
                          name: project.name,
                          writingInstructions: project.writingInstructions,
                          builderType: project.builderType
                        });
                      }}
                      className="opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-indigo-600 transition-all rounded-lg hover:bg-indigo-50"
                      title="Edit Project Settings"
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                    
                    {deletingId === project.id ? (
                      <div className="flex bg-red-50 rounded-lg p-1 animate-in fade-in zoom-in-95 duration-200">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                          className="px-3 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 hover:bg-white rounded-md transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={(e) => handleDeleteProject(e, project.id)}
                          className="px-3 py-1 text-[10px] font-bold text-red-600 hover:text-white bg-white hover:bg-red-500 rounded-md transition-all shadow-sm"
                        >
                          Confirm
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingId(project.id); }}
                        className="opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-red-500 transition-all rounded-lg hover:bg-red-50"
                        title="Delete Project"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <h3 className="text-xl font-bold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">{project.name}</h3>
                
                <div className="flex items-center gap-4 mt-4">
                  <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                    <Zap className="w-4 h-4" />
                    <span className="capitalize">{project.builderType.replace('-', ' ')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                    <Calendar className="w-4 h-4" />
                    <span>{project.createdAt?.toDate ? project.createdAt.toDate().toLocaleDateString() : 'Just now'}</span>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2 text-indigo-600 font-semibold text-sm">
                  <span>View Project</span>
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </>
            )}
          </motion.div>
        ))}

        {projects.length === 0 && !isCreating && (
          <div className="col-span-full py-20 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-100 shadow-sleek">
              <Plus className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">No projects yet</h3>
            <p className="text-slate-500 mt-2 mb-6">Create your first project to start rewriting content.</p>
            <button
              onClick={() => setIsCreating(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 px-6 rounded-xl transition-all inline-flex items-center gap-2 shadow-sleek"
            >
              Get Started
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
