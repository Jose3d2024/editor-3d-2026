import * as THREE from 'three';

/**
 * A singleton utility to render material thumbnails using a single WebGL context.
 * This prevents "Too many WebGL contexts" errors when showing many thumbnails.
 */
class ThumbnailRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private loader: THREE.TextureLoader;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 0.3, 3.2);
    this.camera.lookAt(0, 0, 0);
    this.loader = new THREE.TextureLoader();

    // Setup basic scene once
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(3, 5, 3);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8899cc, 0.6);
    fillLight.position.set(-3, 1, -2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    rimLight.position.set(0, -3, -4);
    this.scene.add(rimLight);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(6, 6);
    const groundMat = new THREE.MeshStandardMaterial({
      color: '#1a1a1f',
      roughness: 0.8,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.05;
    this.scene.add(ground);
  }

  private initRenderer() {
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          canvas: this.canvas,
          antialias: true,
          alpha: false,
          powerPreference: 'low-power',
          failIfMajorPerformanceCaveat: false,
        });
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      } catch (e) {
        console.error('Failed to initialize WebGLRenderer for thumbnails', e);
        return null;
      }
    }
    return this.renderer;
  }

  private renderLock: Promise<any> = Promise.resolve();

  async renderThumbnail(materialData: any, size: number, shapeType: string): Promise<string> {
    // Sequential execution to avoid WebGL context issues and shared resource conflicts
    this.renderLock = this.renderLock.then(async () => {
      const renderer = this.initRenderer();
      if (!renderer) throw new Error('Renderer not available');
      renderer.setSize(size, size, false);
      
      // Clear previous mesh
      const oldMesh = this.scene.getObjectByName('thumbnailMesh');
      if (oldMesh) {
        this.scene.remove(oldMesh);
        (oldMesh as THREE.Mesh).geometry.dispose();
        ((oldMesh as THREE.Mesh).material as THREE.Material).dispose();
      }
      const oldGlow = this.scene.getObjectByName('glowMesh');
      if (oldGlow) {
        this.scene.remove(oldGlow);
        (oldGlow as THREE.Mesh).geometry.dispose();
        ((oldGlow as THREE.Mesh).material as THREE.Material).dispose();
      }
      const oldLight = this.scene.getObjectByName('emissiveLight');
      if (oldLight) this.scene.remove(oldLight);

      // Create material
      const color = new THREE.Color(materialData.color);
      const isEmissive = materialData.emissive && materialData.emissive !== '#000000' && (materialData.emissiveIntensity ?? 0) > 0.05;
      const isGlass = (materialData.transmission ?? 0) > 0.3;
      const isSoapBubble = materialData.csmConfig?.preset === 'soap_bubble' || materialData.id?.includes('soap_bubble');

      let mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
      if (isSoapBubble) {
        mat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(0xf0f9ff),
          roughness: 0.02,
          metalness: 0.05,
          transparent: true,
          opacity: 0.65,
          transmission: 0.95,
          thickness: 0.2,
          ior: 1.333,
          iridescence: 1.0,
          iridescenceIOR: 1.333,
          iridescenceThicknessRange: [220, 780],
          envMapIntensity: 2.0,
        });
      } else if (isGlass || (materialData.transparent && materialData.opacity < 0.85)) {
        mat = new THREE.MeshPhysicalMaterial({
          color,
          roughness: materialData.roughness,
          metalness: materialData.metalness,
          transparent: true,
          opacity: materialData.opacity,
          transmission: materialData.transmission ?? 0,
          thickness: materialData.thickness ?? 0.5,
          ior: materialData.ior ?? 1.5,
          envMapIntensity: 1.5,
        });
      } else {
        mat = new THREE.MeshStandardMaterial({
          color,
          roughness: materialData.roughness,
          metalness: materialData.metalness,
          transparent: materialData.transparent,
          opacity: materialData.opacity,
        });
      }

      if (isEmissive) {
        mat.emissive = new THREE.Color(materialData.emissive);
        mat.emissiveIntensity = Math.min(materialData.emissiveIntensity ?? 1, 5);
      }

      // Load textures
      const loadTexture = (url: string | undefined, sRGB = false) => {
        if (!url) return Promise.resolve(null);
        return new Promise<THREE.Texture | null>((resolve) => {
          this.loader.load(url, (tex) => {
            tex.colorSpace = sRGB ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
            resolve(tex);
          }, undefined, () => resolve(null));
        });
      };

      const [map, normalMap, roughnessMap, metalnessMap] = await Promise.all([
        loadTexture(materialData.map, true),
        loadTexture(materialData.normalMap, false),
        loadTexture(materialData.roughnessMap, false),
        loadTexture(materialData.metalnessMap, false),
      ]);

      if (map) mat.map = map;
      if (normalMap) mat.normalMap = normalMap;
      if (roughnessMap) mat.roughnessMap = roughnessMap;
      if (metalnessMap) mat.metalnessMap = metalnessMap;
      if (materialData.normalScale) (mat as THREE.MeshStandardMaterial).normalScale.set(materialData.normalScale, materialData.normalScale);

      // Geometry
      let geo: THREE.BufferGeometry;
      switch (shapeType) {
        case 'box':      geo = new THREE.BoxGeometry(1.4, 1.4, 1.4, 2, 2, 2); break;
        case 'cylinder': geo = new THREE.CylinderGeometry(0.7, 0.7, 1.6, 32); break;
        case 'torus':    geo = new THREE.TorusGeometry(0.65, 0.28, 24, 48);    break;
        default:         geo = new THREE.SphereGeometry(1.0, 48, 32);          break;
      }

      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'thumbnailMesh';
      mesh.rotation.x = shapeType === 'torus' ? Math.PI * 0.25 : 0.22;
      mesh.rotation.y = shapeType === 'box'   ? Math.PI * 0.18 : -0.15;
      this.scene.add(mesh);

      if (isEmissive) {
        const glowGeo = shapeType === 'sphere' ? new THREE.SphereGeometry(1.18, 16, 12) : geo.clone();
        const glowMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(materialData.emissive),
          transparent: true,
          opacity: 0.08,
          side: THREE.BackSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.name = 'glowMesh';
        glow.rotation.copy(mesh.rotation);
        this.scene.add(glow);

        const pt = new THREE.PointLight(new THREE.Color(materialData.emissive), 1.5, 3);
        pt.name = 'emissiveLight';
        this.scene.add(pt);
      }

      // Render
      renderer.render(this.scene, this.camera);
      
      const dataUrl = this.canvas.toDataURL();

      // Cleanup textures for this render
      [map, normalMap, roughnessMap, metalnessMap].forEach(t => t?.dispose());

      return dataUrl;
    });

    return this.renderLock;
  }
}

export const thumbnailRenderer = new ThumbnailRenderer();
