const fs = require('fs');
let code = fs.readFileSync('src/components/MaterialPanel.tsx', 'utf8');

code = code.replace(
`  const [activeTab, setActiveTab] = useState<'library' | 'textures' | 'edit'>(`,
`  const [activeTab, setActiveTab] = useState<'library' | 'cloud' | 'textures' | 'edit'>(`
);

// Add the Cloud button to all headers
code = code.replaceAll(
`          <button
            onClick={() => setActiveTab('textures')}`,
`          <button
            onClick={() => setActiveTab('cloud')}
            className={"flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all " + (activeTab === 'cloud' ? "bg-sky-600 text-white shadow-md shadow-sky-600/30" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60")}
          >
            <Cloud size={12} />
            <span className="hidden sm:inline">Nube</span>
          </button>
          <button
            onClick={() => setActiveTab('textures')}`
);

// We need to add Cloud to lucide-react imports if not there.
if (!code.includes('Cloud,')) {
    code = code.replace(`Image as ImageIcon,`, `Image as ImageIcon, Cloud,`);
}

fs.writeFileSync('src/components/MaterialPanel.tsx', code);
