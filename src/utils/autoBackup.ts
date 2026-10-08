import { Project } from '../types';
import { useStore } from '../store/useStore';
import { filterUsedMaterials } from '../components/SaveProjectModal';

export interface TempBackupData {
  id: 'current_temp_backup';
  timestamp: number;
  dateStr: string;
  projectName: string;
  objectCount: number;
  lightCount: number;
  vertCount: number;
  faceCount: number;
  project: Project;
}

const DB_NAME = 'CSGStudio_AutoBackup_DB';
const STORE_NAME = 'temp_backups';
const DB_VERSION = 1;
const LOCAL_STORAGE_FALLBACK_KEY = 'csg_temp_autosave_backup_v1';
export const AUTO_BACKUP_INTERVAL_MS = 90_000; // 1.5 minutos (90 segundos)

/**
 * Abre o inicializa la base de datos IndexedDB para copias de seguridad de gran capacidad
 */
function openBackupDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB no soportado en este entorno'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda la copia de seguridad temporal siempre sobre el mismo slot sin sobreescribir el archivo del proyecto
 */
export async function saveTempBackup(project: Project): Promise<TempBackupData> {
  const cleanProject = filterUsedMaterials(JSON.parse(JSON.stringify(project)));
  const now = Date.now();
  
  let totalVerts = 0;
  let totalFaces = 0;
  (cleanProject.objects || []).forEach(o => {
    totalVerts += o.vertices?.length || o.stats?.vertices || 0;
    totalFaces += o.faces?.length || o.stats?.faces || 0;
  });

  const backupData: TempBackupData = {
    id: 'current_temp_backup',
    timestamp: now,
    dateStr: new Date(now).toLocaleTimeString(),
    projectName: cleanProject.name || 'Proyecto Sin Título',
    objectCount: cleanProject.objects?.length || 0,
    lightCount: cleanProject.lights?.length || 0,
    vertCount: totalVerts,
    faceCount: totalFaces,
    project: cleanProject,
  };

  try {
    const db = await openBackupDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(backupData);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (idbErr) {
    // Fallback a localStorage si IndexedDB no estuviera disponible
    try {
      localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, JSON.stringify(backupData));
    } catch (lsErr) {
      console.warn('Advertencia al guardar copia temporal en localStorage:', lsErr);
    }
  }

  // Despachar evento para que componentes reactivos (badges / barras de estado) se enteren
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('csg_autobackup_updated', { detail: backupData }));
  }

  return backupData;
}

/**
 * Obtiene la última copia de seguridad temporal almacenada
 */
export async function getTempBackup(): Promise<TempBackupData | null> {
  try {
    const db = await openBackupDB();
    return await new Promise<TempBackupData | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('current_temp_backup');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    // Fallback a localStorage
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

/**
 * Restaura la copia de seguridad temporal en el store global de la aplicación
 */
export async function restoreTempBackup(): Promise<boolean> {
  const backup = await getTempBackup();
  if (!backup || !backup.project) return false;
  useStore.getState().setProject(backup.project);
  useStore.getState().saveHistory(`Restaurar copia de seguridad temporal (${backup.dateStr})`);
  return true;
}

/**
 * Descarga la copia de seguridad temporal como archivo `.3dproj` (formato estándar de escena completa)
 */
export function downloadBackupFile(backupData?: TempBackupData | Project, filename?: string) {
  let projectToDownload: Project;
  let name = filename;

  if (backupData && (backupData as TempBackupData).project) {
    projectToDownload = (backupData as TempBackupData).project;
    if (!name) name = `copia_temporal_${(backupData as TempBackupData).projectName.replace(/\s+/g, '_')}_${Date.now()}.3dproj`;
  } else if (backupData) {
    projectToDownload = backupData as Project;
    if (!name) name = `copia_temporal_${(projectToDownload.name || 'escena').replace(/\s+/g, '_')}_${Date.now()}.3dproj`;
  } else {
    projectToDownload = useStore.getState().project;
    if (!name) name = `copia_temporal_${(projectToDownload.name || 'escena').replace(/\s+/g, '_')}_${Date.now()}.3dproj`;
  }

  const cleanProject = filterUsedMaterials(JSON.parse(JSON.stringify(projectToDownload)));
  const jsonStr = JSON.stringify(cleanProject, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.3dproj') || name.endsWith('.json') ? name : `${name}.3dproj`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
