const fs = require('fs');
let code = fs.readFileSync('src/components/MaterialPanel.tsx', 'utf8');

code = code.replace(
`  const [activeTab, setActiveTab] = useState<'library' | 'textures' | 'edit'>(isMaterialStudioOpen ? 'edit' : 'library');`,
`  const [activeTab, setActiveTab] = useState<'library' | 'textures' | 'edit'>(
    (isMaterialStudioOpen || (materialStudioMaterialId || activeMaterialId)) ? 'edit' : 'library'
  );`
);

fs.writeFileSync('src/components/MaterialPanel.tsx', code);
