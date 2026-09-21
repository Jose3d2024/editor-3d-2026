import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { Project } from '../types';
import {
  Save,
  FolderOpen,
  X,
  FileText,
  Clock,
  Trash2,
  Download,
  Check,
  HardDrive,
  Copy,
  AlertCircle,
  Camera,
  Image as ImageIcon,
  RotateCw
} from 'lucide-react';
import { captureViewportSnapshot, downloadViewportSnapshot } from '../utils/viewportCapture';

export interface SavedSceneItem {
  id: string;
  name: string;
  savedAt: number;
  objectCount: number;
  lightCount: number;
  project: Project;
  thumbnail?: string;
}

const LOCAL_STORAGE_KEY = 'csg_saved_scenes_library_v1';

export const getSavedScenes = (): SavedSceneItem[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

export const filterUsedMaterials = (project: Project): Project => {
  const usedMaterialIds = new Set<string>();
  const collectObjMaterials = (objs: any[]) => {
    (objs || []).forEach(obj => {
      if (obj.materialId) usedMaterialIds.add(obj.materialId);
      if (obj.material?.id) usedMaterialIds.add(obj.material.id);
      if (obj.materialIds && typeof obj.materialIds === 'object') {
        Object.values(obj.materialIds).forEach(mId => {
          if (mId && typeof mId === 'string') usedMaterialIds.add(mId);
        });
      }
      if (obj.children && Array.isArray(obj.children)) collectObjMaterials(obj.children);
    });
  };
  collectObjMaterials(project.objects);

  let filteredMaterials = (project.materials || []).filter(m => usedMaterialIds.has(m.id));
  
  // If objects exist with inline material but not in project.materials, preserve them
  if (filteredMaterials.length === 0 && project.objects.length > 0) {
    const inlineMats: any[] = [];
    project.objects.forEach(obj => {
      if (obj.material && !inlineMats.some(m => m.id === obj.material.id)) {
        inlineMats.push(obj.material);
      }
    });
    if (inlineMats.length > 0) {
      filteredMaterials = inlineMats;
    }
  }

  return {
    ...project,
    materials: filteredMaterials
  };
};

export const saveSceneToStorage = (project: Project, customThumbnail?: string): SavedSceneItem[] => {
  const existing = getSavedScenes();
  const now = Date.now();
  const cleanProject = filterUsedMaterials(JSON.parse(JSON.stringify(project)));
  
  const thumbnail = customThumbnail || captureViewportSnapshot({ width: 320, height: 200, quality: 0.85 }) || undefined;
  if (thumbnail) {
    (cleanProject as any).thumbnail = thumbnail;
  }

  const sceneItem: SavedSceneItem = {
    id: cleanProject.name || 'Nuevo Proyecto',
    name: cleanProject.name || 'Nuevo Proyecto',
    savedAt: now,
    objectCount: cleanProject.objects.length,
    lightCount: cleanProject.lights.length,
    project: cleanProject,
    thumbnail,
  };

  const filtered = existing.filter(s => s.name !== sceneItem.name);
  const updated = [sceneItem, ...filtered];
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('LocalStorage save warning (trying without thumb):', e);
    try {
      sceneItem.thumbnail = undefined;
      (cleanProject as any).thumbnail = undefined;
      const updatedNoThumb = [sceneItem, ...filtered];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedNoThumb));
    } catch (err2) {
      console.error('LocalStorage critical save error:', err2);
    }
  }
  return updated;
};

export const deleteSavedScene = (sceneName: string): SavedSceneItem[] => {
  const existing = getSavedScenes();
  const updated = existing.filter(s => s.name !== sceneName);
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('LocalStorage delete warning:', e);
  }
  return updated;
};

interface SaveProjectModalProps {
  isOpen: boolean;
  mode?: 'save' | 'save_as' | 'open';
  onClose: () => void;
  onSuccessNotification?: (message: string) => void;
}

export const SaveProjectModal: React.FC<SaveProjectModalProps> = ({
  isOpen,
  mode = 'save',
  onClose,
  onSuccessNotification,
}) => {
  const { project, setProject } = useStore();
  const [projectName, setProjectName] = useState(project.name || 'Nuevo Proyecto');
  const [downloadJsonToo, setDownloadJsonToo] = useState(false);
  const [downloadImageToo, setDownloadImageToo] = useState(false);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [savedScenes, setSavedScenes] = useState<SavedSceneItem[]>([]);
  const [selectedScene, setSelectedScene] = useState<SavedSceneItem | null>(null);
  const [activeTab, setActiveTab] = useState<'save' | 'library'>(mode === 'open' ? 'library' : 'save');
  const [feedback, setFeedback] = useState<string | null>(null);

  const usedMaterialIds = React.useMemo(() => {
    const ids = new Set<string>();
    const collect = (objs: any[]) => {
      (objs || []).forEach(obj => {
        if (obj.materialId) ids.add(obj.materialId);
        if (obj.material?.id) ids.add(obj.material.id);
        if (obj.materialIds && typeof obj.materialIds === 'object') {
          Object.values(obj.materialIds).forEach(mId => {
            if (mId && typeof mId === 'string') ids.add(mId);
          });
        }
        if (obj.children) collect(obj.children);
      });
    };
    collect(project.objects);
    return ids;
  }, [project.objects]);

  const usedMaterialsCount = usedMaterialIds.size > 0
    ? usedMaterialIds.size
    : (project.objects.some(o => o.material) ? 1 : (project.objects.length > 0 ? 1 : 0));

  useEffect(() => {
    if (isOpen) {
      setProjectName(project.name || 'Nuevo Proyecto');
      const scenes = getSavedScenes();
      setSavedScenes(scenes);
      if (scenes.length > 0) {
        setSelectedScene(scenes[0]);
      }
      setActiveTab(mode === 'open' ? 'library' : 'save');
      setFeedback(null);
      // Capture live snapshot of the viewport
      const snap = captureViewportSnapshot({ width: 320, height: 200, quality: 0.88 });
      setThumbnailPreview(snap);
    }
  }, [isOpen, project.name, mode]);

  if (!isOpen) return null;

  const handlePerformSave = (overwriteExisting = true) => {
    const finalName = projectName.trim() || 'Nuevo Proyecto';

    // Update project state name
    const updatedProject: Project = {
      ...project,
      name: finalName,
    };
    setProject(updatedProject);

    // Save to persistent localStorage library with thumbnail
    saveSceneToStorage(updatedProject, thumbnailPreview || undefined);

    // If requested, download thumbnail image
    if (downloadImageToo) {
      downloadViewportSnapshot(`${finalName}_miniatura.png`);
    }

    // If requested or as backup download JSON
    if (downloadJsonToo) {
      const cleanProject = filterUsedMaterials(updatedProject);
      if (thumbnailPreview) {
        (cleanProject as any).thumbnail = thumbnailPreview;
      }
      const blob = new Blob([JSON.stringify(cleanProject, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${finalName}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    const msg = `Proyecto "${finalName}" guardado y sobreescrito correctamente.`;
    if (onSuccessNotification) {
      onSuccessNotification(msg);
    }
    onClose();
  };

  const handleLoadScene = (scene: SavedSceneItem) => {
    try {
      setProject(scene.project);
      if (onSuccessNotification) {
        onSuccessNotification(`Escena "${scene.name}" cargada con éxito.`);
      }
      onClose();
    } catch (e) {
      setFeedback('Error al cargar la escena guardada.');
    }
  };

  const handleDelete = (sceneName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = deleteSavedScene(sceneName);
    setSavedScenes(updated);
    setFeedback(`Escena "${sceneName}" eliminada de la biblioteca.`);
  };

  const isOverwrite = savedScenes.some(s => s.name === projectName.trim());

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn select-none">
      <div className={`bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl ${activeTab === 'library' ? 'max-w-3xl' : 'max-w-lg'} w-full overflow-hidden text-zinc-100 p-6 space-y-4 transition-all duration-200`}>
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {activeTab === 'save' ? <Save size={20} /> : <FolderOpen size={20} />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                {activeTab === 'save' ? (mode === 'save_as' ? 'Guardar Escena Como...' : 'Guardar Escena') : 'Biblioteca de Escenas'}
              </h3>
              <p className="text-[11px] text-zinc-400">
                {activeTab === 'save'
                  ? 'Guarda y sobreescribe tu escena con miniatura del visor en la memoria local.'
                  : 'Carga proyectos guardados previamente en tu navegador.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('save')}
            className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'save' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Save size={13} />
            <span>Guardar / Sobreescribir</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('library');
              setSavedScenes(getSavedScenes());
            }}
            className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'library' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FolderOpen size={13} />
            <span>Mis Escenas ({savedScenes.length})</span>
          </button>
        </div>

        {/* Tab Content: Save */}
        {activeTab === 'save' && (
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                <span>Nombre del Proyecto:</span>
                {isOverwrite && (
                  <span className="text-[10px] text-amber-400 font-mono bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-700/40">
                    ⚠️ Sobreescribirá la escena existente
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="Nuevo Proyecto"
                  autoFocus
                  onFocus={e => e.target.select()}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handlePerformSave(true);
                    if (e.key === 'Escape') onClose();
                  }}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-sm text-white font-medium focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* Viewport Thumbnail Snapshot Preview */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                <span className="flex items-center gap-1.5">
                  <Camera size={13} className="text-indigo-400" />
                  <span>Miniatura del visor actual:</span>
                </span>
                <span className="text-[9.5px] text-zinc-500 font-mono font-normal">
                  Se adjunta a la escena guardada
                </span>
              </div>
              <div className="relative w-full h-28 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 flex items-center justify-center group">
                {thumbnailPreview ? (
                  <>
                    <img
                      src={thumbnailPreview}
                      alt="Miniatura de la escena"
                      className="w-full h-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const fresh = captureViewportSnapshot({ width: 320, height: 200, quality: 0.88 });
                        if (fresh) setThumbnailPreview(fresh);
                      }}
                      title="Recapturar visor ahora"
                      className="absolute bottom-2 right-2 px-2 py-1 bg-black/75 hover:bg-black/95 text-[10px] text-zinc-200 rounded-lg backdrop-blur-xs border border-white/10 flex items-center gap-1 transition-all cursor-pointer shadow-md"
                    >
                      <RotateCw size={10} className="text-indigo-400" />
                      <span>Recapturar</span>
                    </button>
                  </>
                ) : (
                  <div className="text-zinc-500 text-xs flex items-center gap-2">
                    <Camera size={16} />
                    <span>Visor listo para captura</span>
                  </div>
                )}
              </div>
            </div>

            {/* Scene details */}
            <div className="grid grid-cols-3 gap-2 p-2.5 bg-zinc-950/60 rounded-xl border border-zinc-800/80 text-[11px] text-zinc-400">
              <div>
                <span className="text-zinc-500 block">Objetos:</span>
                <span className="text-zinc-200 font-bold font-mono text-xs">{project.objects.length}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Luces:</span>
                <span className="text-zinc-200 font-bold font-mono text-xs">{project.lights.length}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Materiales:</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-emerald-400 font-bold font-mono text-xs">{usedMaterialsCount}</span>
                  <span className="text-[9px] text-zinc-500">aplicados</span>
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="space-y-1.5 pt-1">
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={downloadJsonToo}
                  onChange={e => setDownloadJsonToo(e.target.checked)}
                  className="rounded border-zinc-700 text-indigo-500 focus:ring-0 bg-zinc-800 cursor-pointer"
                />
                <Download size={13} className="text-indigo-400" />
                <span>Descargar también archivo .json al equipo</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={downloadImageToo}
                  onChange={e => setDownloadImageToo(e.target.checked)}
                  className="rounded border-zinc-700 text-indigo-500 focus:ring-0 bg-zinc-800 cursor-pointer"
                />
                <ImageIcon size={13} className="text-indigo-400" />
                <span>Descargar también imagen de miniatura (.png) al equipo</span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handlePerformSave(true)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <Save size={14} />
                <span>{isOverwrite ? 'Sobreescribir y Guardar' : 'Guardar Proyecto'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab Content: Library */}
        {activeTab === 'library' && (
          <div className="space-y-3 pt-1">
            {feedback && (
              <div className="p-2 bg-indigo-950/60 border border-indigo-700/50 rounded-lg text-indigo-300 text-xs flex items-center gap-2">
                <AlertCircle size={14} />
                <span>{feedback}</span>
              </div>
            )}

            {savedScenes.length === 0 ? (
              <div className="text-center py-10 text-zinc-500 text-xs space-y-2">
                <HardDrive size={36} className="mx-auto text-zinc-600 opacity-50" />
                <p className="font-semibold text-zinc-400">No tienes escenas guardadas localmente todavía.</p>
                <p className="text-[11px] text-zinc-500">Usa la pestaña "Guardar" para guardar tu primera escena con miniatura.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                {/* File Explorer List (Left Column) */}
                <div className="md:col-span-7 max-h-80 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                  <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider px-1 pb-1 flex items-center justify-between">
                    <span>Archivos guardados ({savedScenes.length})</span>
                    <span className="text-zinc-500 font-normal">Haz clic para vista previa</span>
                  </div>
                  {savedScenes.map(scene => {
                    const isSelected = selectedScene?.name === scene.name;
                    return (
                      <div
                        key={scene.name}
                        onClick={() => setSelectedScene(scene)}
                        onDoubleClick={() => handleLoadScene(scene)}
                        className={`p-2 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-indigo-950/60 border-indigo-500 shadow-sm ring-1 ring-indigo-500/30'
                            : 'bg-zinc-950/80 hover:bg-zinc-800/60 border-zinc-800/80 text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {scene.thumbnail ? (
                            <img
                              src={scene.thumbnail}
                              alt={scene.name}
                              className="w-12 h-9 rounded-md object-cover border border-zinc-800 bg-zinc-900 shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-9 rounded-md border border-zinc-800 bg-zinc-900 flex items-center justify-center text-zinc-500 shrink-0">
                              <FileText size={15} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-semibold text-xs truncate max-w-[150px] ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                                {scene.name}
                              </span>
                              {scene.name === project.name && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-900/80 text-indigo-300 border border-indigo-700/50 font-mono shrink-0">
                                  Actual
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                              <span>{new Date(scene.savedAt).toLocaleDateString()}</span>
                              <span>•</span>
                              <span>{scene.objectCount} obj</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleDelete(scene.name, e)}
                            title="Eliminar escena"
                            className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-950/50 transition-colors cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoadScene(scene);
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                            }`}
                          >
                            Abrir
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Windows Explorer Style Preview Pane (Right Column) */}
                <div className="md:col-span-5 bg-zinc-950 rounded-xl border border-zinc-800/90 p-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80 mb-2.5">
                      <span className="text-[10.5px] uppercase font-bold text-zinc-300 tracking-wider flex items-center gap-1.5">
                        <ImageIcon size={12} className="text-cyan-400" />
                        <span>Panel de Vista Previa</span>
                      </span>
                      <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/40">
                        Windows style
                      </span>
                    </div>

                    {selectedScene ? (
                      <div className="space-y-2.5">
                        {/* Big preview snapshot */}
                        <div className="w-full aspect-video bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden flex items-center justify-center relative shadow-inner">
                          {selectedScene.thumbnail ? (
                            <img
                              src={selectedScene.thumbnail}
                              alt={selectedScene.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="text-center p-3 text-zinc-600 space-y-1">
                              <Camera size={24} className="mx-auto opacity-50" />
                              <p className="text-[10px]">Sin miniatura previa</p>
                            </div>
                          )}
                        </div>

                        {/* File Details */}
                        <div className="space-y-1">
                          <h4 className="font-bold text-xs text-white truncate" title={selectedScene.name}>
                            {selectedScene.name}
                          </h4>
                          <div className="text-[10.5px] space-y-0.5 text-zinc-400 bg-zinc-900/80 p-2 rounded-lg border border-zinc-800/60 font-mono">
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Objetos:</span>
                              <span className="text-zinc-200 font-bold">{selectedScene.objectCount}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Luces:</span>
                              <span className="text-zinc-200 font-bold">{selectedScene.lightCount}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Guardado:</span>
                              <span className="text-zinc-300">{new Date(selectedScene.savedAt).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-zinc-600 text-xs">
                        Selecciona un archivo para ver su vista previa
                      </div>
                    )}
                  </div>

                  {selectedScene && (
                    <div className="pt-3 border-t border-zinc-800/80 flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          const clean = filterUsedMaterials(selectedScene.project);
                          if (selectedScene.thumbnail) {
                            (clean as any).thumbnail = selectedScene.thumbnail;
                          }
                          const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${selectedScene.name}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        title="Descargar archivo .json"
                        className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Download size={12} />
                        <span>.JSON</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLoadScene(selectedScene)}
                        className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <FolderOpen size={13} />
                        <span>Cargar en Visor</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
