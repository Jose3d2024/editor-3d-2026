import React, { useState } from 'react';
import { ViewportType, Project } from '../../types';
import { Camera, Globe, Eye, ChevronDown, Target } from 'lucide-react';

interface ViewportHeaderProps {
  type: ViewportType;
  title: string;
  viewCameraId: string | null;
  maximizedViewport: ViewportType | null;
  project: Project;
  activeViewport: ViewportType;
  isRecording?: boolean;
  onSelectType: (type: ViewportType, title: string) => void;
  onSelectCamera: (cameraId: string, name: string) => void;
  onToggleMaximize: () => void;
}

export const ViewportHeader: React.FC<ViewportHeaderProps> = ({
  type,
  title,
  viewCameraId,
  maximizedViewport,
  project,
  activeViewport,
  isRecording,
  onSelectType,
  onSelectCamera,
  onToggleMaximize,
}) => {
  const [showViewDropdown, setShowViewDropdown] = useState(false);

  return (
    <div className="absolute top-1 left-1 sm:top-2 sm:left-2 z-40 flex items-center gap-1.5 flex-wrap pointer-events-auto">
      {/* Title & Maximize / Quad Toggle */}
      <div
        className="px-1.5 py-0.5 sm:px-2 sm:py-1 bg-black/50 hover:bg-black/70 text-[8px] sm:text-xs text-white rounded font-mono uppercase tracking-wider cursor-pointer hover:text-indigo-300 select-none border border-white/10 hover:border-white/30 flex items-center gap-1.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-all backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleMaximize();
        }}
      >
        {viewCameraId ? (
          <Camera size={13} className="text-indigo-400 shrink-0 animate-pulse" />
        ) : type === 'PERSPECTIVE' ? (
          <Globe size={13} className="text-indigo-300 shrink-0" />
        ) : (
          <Eye size={13} className="text-zinc-400 shrink-0" />
        )}
        <span>
          {title} {maximizedViewport === type ? '[-]' : '[+]'}
        </span>
        {maximizedViewport === type && (
          <div
            className="ml-2 px-1 bg-indigo-600 hover:bg-indigo-500 rounded text-[8px] font-bold"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMaximize();
            }}
          >
            RESTAURAR 4 VISTAS
          </div>
        )}
      </div>

      {/* Camera Target Status Badge when viewing through a Camera */}
      {type === 'CAMERA' && viewCameraId && (
        <div className="bg-indigo-950/80 border border-indigo-500/40 text-indigo-200 px-2 py-0.5 rounded text-[9px] font-mono flex items-center gap-1.5 shadow-lg backdrop-blur-sm select-none">
          <Camera size={11} className="text-indigo-400 shrink-0" />
          <span className="font-bold text-indigo-300">VISTA CÁMARA</span>
          {(() => {
            const activeCam = project.cameras?.find((c) => c.id === viewCameraId);
            if (activeCam?.targetObjectId) {
              const targetObj = project.objects.find((o) => o.id === activeCam.targetObjectId);
              return (
                <span className="text-indigo-200 text-[9px] border-l border-indigo-500/40 pl-1.5 flex items-center gap-1">
                  <Target size={10} className="text-indigo-400 shrink-0" />
                  <span>
                    Objetivo: <strong className="text-white font-bold">{targetObj?.name || 'Objeto'}</strong>
                  </span>
                </span>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* View Selector Dropdown */}
      <div
        className="relative"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={() => setShowViewDropdown(true)}
        onMouseLeave={() => setShowViewDropdown(false)}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowViewDropdown((prev) => !prev);
          }}
          className="p-1 sm:p-1.5 bg-black/50 hover:bg-zinc-800 text-white rounded border border-white/20 hover:border-indigo-400 transition-colors drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] flex items-center gap-1 cursor-pointer"
          title="Seleccionar Visor"
        >
          <ChevronDown
            size={12}
            className={`transition-transform duration-150 ${showViewDropdown ? 'rotate-180' : ''}`}
          />
        </button>

        {showViewDropdown && (
          <div className="absolute top-full left-0 pt-1 min-w-[150px] z-[100] max-h-[220px] sm:max-h-[260px]">
            <div className="bg-zinc-900/98 backdrop-blur-md border border-white/20 rounded-md shadow-2xl overflow-y-auto max-h-[210px] sm:max-h-[250px] py-1 custom-scrollbar scrollbar-thin scrollbar-thumb-zinc-700">
              <div className="px-3 py-1 text-[9px] font-bold text-zinc-400 uppercase tracking-wider border-b border-white/10 sticky top-0 bg-zinc-900 z-10">
                Visores 3D
              </div>
              {(['PERSPECTIVE', 'TOP', 'BOTTOM', 'FRONT', 'BACK', 'LEFT', 'RIGHT'] as ViewportType[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectType(v, v.charAt(0) + v.slice(1).toLowerCase());
                    setShowViewDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-indigo-600 hover:text-white transition-colors flex items-center justify-between cursor-pointer ${
                    type === v && !viewCameraId
                      ? 'text-indigo-400 font-bold bg-indigo-950/50'
                      : 'text-zinc-200'
                  }`}
                >
                  <span>{v}</span>
                  {type === v && !viewCameraId && <span className="text-[9px] text-indigo-300">✓</span>}
                </button>
              ))}
              {project.cameras && project.cameras.length > 0 && (
                <>
                  <div className="h-px bg-white/10 my-1" />
                  <div className="px-3 py-1 text-[9px] font-bold text-zinc-400 uppercase tracking-wider border-b border-white/10">
                    Cámaras
                  </div>
                  {project.cameras.map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCamera(cam.id, cam.name);
                        setShowViewDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-indigo-600 hover:text-white transition-colors flex items-center justify-between cursor-pointer ${
                        viewCameraId === cam.id
                          ? 'text-indigo-400 font-bold bg-indigo-950/50'
                          : 'text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Camera
                          size={12}
                          className={viewCameraId === cam.id ? 'text-indigo-400 shrink-0' : 'text-zinc-400 shrink-0'}
                        />
                        <span className="truncate max-w-[100px]">{cam.name}</span>
                      </div>
                      {viewCameraId === cam.id && <span className="text-[9px] text-indigo-300 shrink-0">✓</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {isRecording && activeViewport === type && (
        <span className="flex items-center gap-1 text-red-500 animate-pulse bg-black/60 px-2 py-1 rounded border border-red-500/30 text-[10px]">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          REC
        </span>
      )}
    </div>
  );
};
