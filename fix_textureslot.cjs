const fs = require('fs');
let code = fs.readFileSync('src/components/MaterialPanel.tsx', 'utf8');

code = code.replace(
`const TextureSlot: React.FC<{ 
  label: string; 
  texture?: string; 
  onDrop: (e: React.DragEvent) => void; 
  onClear: () => void;
  isLarge?: boolean;
}> = ({ label, texture, onDrop, onClear, isLarge }) => {
  const [isOver, setIsOver] = useState(false);

  return (
    <div className={\`space-y-1.5 \${isLarge ? 'col-span-2' : ''}\`}>
      <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-tighter truncate block" title={label}>{label}</label>
      <div
        onDragOver={e => { e.preventDefault(); setIsOver(true); }}
        onDragLeave={() => setIsOver(false)}
        onDrop={e => { onDrop(e); setIsOver(false); }}
        className={\`relative group aspect-square rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center overflow-hidden \${
          texture 
            ? 'border-indigo-500/50 bg-indigo-500/5' 
            : isOver ? 'border-indigo-400 bg-indigo-400/10' : 'border-white/5 bg-white/5 hover:border-white/10'
        } \${isLarge ? 'aspect-[2/1]' : ''}\`}
      >`,
`const TextureSlot: React.FC<{ 
  label: string; 
  texture?: string; 
  onDrop: (e: React.DragEvent) => void; 
  onDropFile?: (file: File) => void;
  onClear: () => void;
  isLarge?: boolean;
}> = ({ label, texture, onDrop, onDropFile, onClear, isLarge }) => {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onDropFile) {
      onDropFile(file);
    } else if (file) {
      // Fallback if no specific handler provided, simulate drop (not ideal but works for our case if we modify onDrop logic, wait, we can just trigger a reader here)
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dummyEvent = {
          dataTransfer: {
            getData: () => ev.target?.result as string,
            files: [file]
          },
          preventDefault: () => {},
          stopPropagation: () => {}
        } as unknown as React.DragEvent;
        onDrop(dummyEvent);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className={\`space-y-1.5 \${isLarge ? 'col-span-2' : ''}\`}>
      <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-tighter truncate block" title={label}>{label}</label>
      <input type="file" ref={inputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
      <div
        onClick={handleClick}
        onDragOver={e => { e.preventDefault(); setIsOver(true); }}
        onDragLeave={() => setIsOver(false)}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop(e); setIsOver(false); }}
        className={\`relative group cursor-pointer aspect-square rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center overflow-hidden \${
          texture 
            ? 'border-indigo-500/50 bg-indigo-500/5' 
            : isOver ? 'border-indigo-400 bg-indigo-400/10' : 'border-white/5 bg-white/5 hover:border-white/10'
        } \${isLarge ? 'aspect-[2/1]' : ''}\`}
      >`
);

code = code.replace(
`            <button 
              onClick={onClear}`,
`            <button 
              onClick={(e) => { e.stopPropagation(); onClear(); }}`
);

fs.writeFileSync('src/components/MaterialPanel.tsx', code);
