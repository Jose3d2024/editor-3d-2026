import React from 'react';
import { Project, CSGObject } from '../../types';
import { safeFixed } from '../../utils/numberUtils';

interface ViewportInfoOverlayProps {
  selectedObject: CSGObject | null;
  interpolatedPos?: [number, number, number];
  isContextLost: boolean;
}

export const ViewportInfoOverlay: React.FC<ViewportInfoOverlayProps> = ({
  selectedObject,
  interpolatedPos,
  isContextLost,
}) => {
  return (
    <>
      {/* Object Coordinate Display */}
      {selectedObject && (
        <div className="absolute bottom-1 left-1 z-30 px-1.5 py-0.5 bg-black/50 text-[10px] text-white font-mono rounded pointer-events-none select-none">
          {(() => {
            const pos = interpolatedPos || selectedObject.transform.position || [0, 0, 0];
            return `X:${safeFixed(pos[0], 2)} Y:${safeFixed(pos[1], 2)} Z:${safeFixed(pos[2], 2)}${
              selectedObject.keyframes?.length ? ` [${selectedObject.keyframes.length}kf]` : ''
            }`;
          })()}
        </div>
      )}

      {/* WebGL Context Lost Recovery Overlay */}
      {isContextLost && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center z-50 text-white p-4 select-none pointer-events-auto">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs font-bold text-amber-300 uppercase tracking-wider">Contexto WebGL Suspendido</p>
          <p className="text-[11px] text-zinc-400 mt-1.5 text-center max-w-xs leading-relaxed">
            El navegador pausó temporalmente los recursos gráficos de la GPU. Esperando reactivación automática...
          </p>
        </div>
      )}
    </>
  );
};
