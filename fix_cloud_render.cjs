const fs = require('fs');
let code = fs.readFileSync('src/components/MaterialPanel.tsx', 'utf8');

const cloudRender = `
  if (activeTab === 'cloud') {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-[#141417] text-zinc-300">
        {/* ── SELECTOR SUPERIOR DE PESTAÑAS ── */}
        <div className="flex items-center p-1.5 bg-[#101013] border-b border-white/10 gap-1 flex-shrink-0">
          <button
            onClick={() => setActiveTab('library')}
            className={"flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"}
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">Materiales</span>
          </button>
          <button
            onClick={() => setActiveTab('cloud')}
            className="flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all bg-sky-600 text-white shadow-md shadow-sky-600/30"
          >
            <Cloud size={12} />
            <span className="hidden sm:inline">Nube</span>
          </button>
          <button
            onClick={() => setActiveTab('textures')}
            className={"flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"}
          >
            <ImageIcon size={12} />
            <span className="hidden sm:inline">Texturas</span>
          </button>
          <button
            onClick={() => {
              if (activeMaterial) setActiveTab('edit');
              else if (materials.length > 0) { setEditingMaterialId(materials[0].id); setActiveTab('edit'); }
              else handleCreateMaterial();
            }}
            className={"flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"}
          >
            <Settings size={12} />
            <span className="hidden sm:inline">Editor PBR</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
          <div className="p-4 bg-sky-900/20 border border-sky-500/20 rounded-xl flex items-center gap-4">
            <div className="p-3 bg-sky-500/20 text-sky-400 rounded-lg">
              <Cloud size={24} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-sky-300">Substance 3D Library</h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">Explora materiales PBR inspirados en Adobe Substance 3D. Selecciona para importar a tu proyecto local.</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'sub_gold', name: 'Oro Martillado', desc: 'Metal precioso con relieve', color: '#ffb833', type: 'metal' },
              { id: 'sub_carbon', name: 'Fibra de Carbono', desc: 'Patrón trenzado industrial', color: '#1a1a1a', type: 'synthetic' },
              { id: 'sub_leather', name: 'Cuero Envejecido', desc: 'Textura orgánica realista', color: '#5c3a21', type: 'organic' },
              { id: 'sub_wood', name: 'Nogal Barnizado', desc: 'Madera fina con anillos', color: '#3d2314', type: 'wood' },
              { id: 'sub_concrete', name: 'Hormigón Armado', desc: 'Concreto gris poroso', color: '#888888', type: 'stone' },
              { id: 'sub_ceramic', name: 'Cerámica Esmaltada', desc: 'Superficie vítrea brillante', color: '#f0f0f0', type: 'stone' }
            ].map(mat => (
              <div key={mat.id} className="p-3 border border-white/5 bg-zinc-900 rounded-xl hover:bg-zinc-800 transition-colors flex flex-col items-center text-center gap-2 group cursor-pointer" onClick={() => {
                const newId = mat.id + '_' + Math.random().toString(36).substr(2,6);
                addMaterial({
                  id: newId,
                  name: mat.name,
                  color: mat.color,
                  roughness: mat.type === 'metal' ? 0.2 : 0.6,
                  metalness: mat.type === 'metal' ? 1.0 : 0.0,
                  uvwMapping: 'box'
                });
                setActiveTab('library');
              }}>
                <div className="w-16 h-16 rounded-full border-2 border-white/10 shadow-lg shadow-black/50 group-hover:scale-110 transition-transform duration-300" style={{backgroundColor: mat.color}} />
                <div>
                  <h4 className="text-[11px] font-bold text-zinc-200">{mat.name}</h4>
                  <p className="text-[9px] text-zinc-500 line-clamp-2 mt-0.5 leading-tight">{mat.desc}</p>
                </div>
                <div className="mt-2 px-3 py-1 text-[9px] font-bold bg-sky-500/20 text-sky-300 rounded hover:bg-sky-500 hover:text-white transition-colors w-full">Descargar</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
`;

code = code.replace(
`  if (activeTab === 'library') {`,
  cloudRender + `\n  if (activeTab === 'library') {`
);

fs.writeFileSync('src/components/MaterialPanel.tsx', code);
