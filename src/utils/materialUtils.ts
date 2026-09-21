import * as THREE from 'three';
import type { MaterialData } from '../types';
import { createRaymarchedCloudMaterial } from './volumetricRaymarch';
import { createCustomShaderMaterial, updateCSMUniforms } from './customShaderMaterial';
import { injectWebGPUGlassShader, updateWebGPUGlassUniforms } from './webgpuGlassMaterial';

/**
 * Safely converts a Three.js Texture to a base64 PNG Data URL so it can be stored,
 * previewed in 2D UI panels, edited in MapEditorModal, and used across viewports.
 */
export function textureToDataURL(texture: THREE.Texture | null | undefined): string | undefined {
  if (!texture) return undefined;
  
  const img: any = texture.image || (texture as any).source?.data;
  if (!img) return undefined;

  try {
    // If it's already a DataURL, return it directly
    if (typeof img.src === 'string' && img.src.startsWith('data:image/')) {
      return img.src;
    }

    const width = img.width || img.naturalWidth || img.videoWidth || (img.data ? 512 : 512);
    const height = img.height || img.naturalHeight || img.videoHeight || (img.data ? 512 : 512);
    if (!width || !height || width <= 0 || height <= 0) {
      if (typeof img.src === 'string' && !img.src.startsWith('blob:')) return img.src;
      return undefined;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width, 2048);
    canvas.height = Math.min(height, 2048);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    if (img instanceof ImageData) {
      ctx.putImageData(img, 0, 0);
    } else if (img.data && (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray)) {
      const imgData = ctx.createImageData(width, height);
      imgData.data.set(img.data);
      ctx.putImageData(imgData, 0, 0);
    } else {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('Could not convert texture to DataURL', e);
    if (typeof img.src === 'string' && !img.src.startsWith('blob:')) {
      return img.src;
    }
    return undefined;
  }
}

/**
 * Extracts all PBR materials from a Three.js Object3D hierarchy (GLTF scene, OBJ, etc.)
 */
export function extractPBRMaterialsFromObject3D(object: THREE.Object3D, baseName = 'Objeto'): MaterialData[] {
  const materials: MaterialData[] = [];
  const seen = new Set<THREE.Material>();
  let matCount = 0;

  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (m && !seen.has(m)) {
          seen.add(m);
          matCount++;
          const pbr = m as any;

          const getFlipY = () => {
            if (pbr.map) return pbr.map.flipY;
            if (pbr.normalMap) return pbr.normalMap.flipY;
            if (pbr.roughnessMap) return pbr.roughnessMap.flipY;
            if (pbr.metalnessMap) return pbr.metalnessMap.flipY;
            return true;
          };

          const matId = 'mat_imp_' + Math.random().toString(36).substr(2, 9);
          m.userData.csgMaterialId = matId;

          const rawName = (m.name && m.name.trim() !== '') ? m.name.trim() : `${baseName}_Material_${matCount}`;
          
          const albedoData = textureToDataURL(pbr.map);
          const normalData = textureToDataURL(pbr.normalMap);
          const roughData = textureToDataURL(pbr.roughnessMap);
          const metalData = textureToDataURL(pbr.metalnessMap);
          const aoData = textureToDataURL(pbr.aoMap);
          const emissiveData = textureToDataURL(pbr.emissiveMap);
          const alphaData = textureToDataURL(pbr.alphaMap);
          const transData = textureToDataURL(pbr.transmissionMap);
          const thickData = textureToDataURL(pbr.thicknessMap);
          const dispData = textureToDataURL(pbr.displacementMap);

          const hasRealTransmission = typeof pbr.transmission === 'number' && pbr.transmission > 0.01;

          const matData: MaterialData = {
            id: matId,
            name: rawName,
            category: 'imported',
            color: pbr.color ? '#' + pbr.color.getHexString() : '#ffffff',
            roughness: typeof pbr.roughness === 'number' ? pbr.roughness : 0.5,
            metalness: typeof pbr.metalness === 'number' ? pbr.metalness : 0,
            opacity: typeof m.opacity === 'number' ? m.opacity : 1,
            transparent: m.transparent === true && (m.opacity < 1 || !hasRealTransmission),
            emissive: pbr.emissive ? '#' + pbr.emissive.getHexString() : '#000000',
            emissiveIntensity: typeof pbr.emissiveIntensity === 'number' ? pbr.emissiveIntensity : 1,
            ior: typeof pbr.ior === 'number' ? pbr.ior : 1.5,
            transmission: hasRealTransmission ? pbr.transmission : 0,
            thickness: (hasRealTransmission && typeof pbr.thickness === 'number') ? pbr.thickness : 0,
            attenuationColor: pbr.attenuationColor ? '#' + pbr.attenuationColor.getHexString() : undefined,
            attenuationDistance: typeof pbr.attenuationDistance === 'number' ? pbr.attenuationDistance : undefined,
            clearcoat: typeof pbr.clearcoat === 'number' ? pbr.clearcoat : 0,
            clearcoatRoughness: typeof pbr.clearcoatRoughness === 'number' ? pbr.clearcoatRoughness : 0,
            sheen: typeof pbr.sheen === 'number' ? pbr.sheen : 0,
            sheenColor: pbr.sheenColor ? '#' + pbr.sheenColor.getHexString() : undefined,
            map: albedoData,
            normalMap: normalData,
            roughnessMap: roughData,
            metalnessMap: metalData,
            aoMap: aoData,
            emissiveMap: emissiveData,
            alphaMap: alphaData,
            transmissionMap: transData,
            thicknessMap: thickData,
            displacementMap: dispData,
            flipY: getFlipY(),
            mapRepeat: pbr.map?.repeat ? [pbr.map.repeat.x, pbr.map.repeat.y] : undefined,
            mapOffset: pbr.map?.offset ? [pbr.map.offset.x, pbr.map.offset.y] : undefined,
            mapRotation: pbr.map?.rotation ? (pbr.map.rotation * 180) / Math.PI : undefined,
          };

          materials.push(matData);
        }
      });
    }
  });

  return materials;
}

/**
 * Parses meshData (GLTF, GLB, OBJ) and extracts all PBR materials asynchronously.
 */
export async function extractPBRMaterialFromGLTFOrOBJ(
  meshData: { type: string; data: string },
  baseName = 'Modelo'
): Promise<MaterialData[]> {
  if (!meshData || !meshData.data) return [];

  if (meshData.type === 'gltf' || meshData.type === 'glb') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(draco);

    return new Promise((resolve) => {
      loader.load(
        meshData.data,
        (gltf) => {
          const mats = extractPBRMaterialsFromObject3D(gltf.scene, baseName);
          resolve(mats);
        },
        undefined,
        (err) => {
          console.warn('Error loading GLTF to extract materials:', err);
          resolve([]);
        }
      );
    });
  } else if (meshData.type === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    return new Promise((resolve) => {
      new OBJLoader().load(
        meshData.data,
        (obj3d) => {
          const mats = extractPBRMaterialsFromObject3D(obj3d, baseName);
          resolve(mats);
        },
        undefined,
        (err) => {
          console.warn('Error loading OBJ to extract materials:', err);
          resolve([]);
        }
      );
    });
  }
  return [];
}

/**
 * Combines AO, Roughness, and Metalness maps into a single ORM texture.
 * R: Ambient Occlusion
 * G: Roughness
 * B: Metalness
 */
export async function createORMMap(
  imgAO: string | null,
  imgRough: string | null,
  imgMetal: string | null,
  width = 512,
  height = 512
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Default: AO=1 (white), Roughness=1 (white), Metalness=0 (black)
  ctx.fillStyle = 'rgb(255, 255, 0)'; // R=255, G=255, B=0
  ctx.fillRect(0, 0, width, height);

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  const drawChannel = async (src: string | null, channelIndex: number) => {
    if (!src) return;
    try {
      const img = await loadImage(src);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;
      tempCtx.drawImage(img, 0, 0, width, height);
      const imageData = tempCtx.getImageData(0, 0, width, height);
      const targetData = ctx.getImageData(0, 0, width, height);

      for (let i = 0; i < imageData.data.length; i += 4) {
        // Use the red channel of the source as the data for the target channel
        targetData.data[i + channelIndex] = imageData.data[i];
      }
      ctx.putImageData(targetData, 0, 0);
    } catch (e) {
      console.error('Error loading image for ORM channel:', e);
    }
  };

  await drawChannel(imgAO, 0);    // Red
  await drawChannel(imgRough, 1); // Green
  await drawChannel(imgMetal, 2); // Blue

  return canvas.toDataURL('image/png');
}

/**
 * Injects custom ORM intensity controls into a MeshStandardMaterial's shader.
 */
export function injectORMControls(material: THREE.MeshStandardMaterial, data: MaterialData) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAoIntensity = { value: data.ormIntensityAO ?? 1.0 };
    shader.uniforms.uRoughnessIntensity = { value: data.ormIntensityRoughness ?? 1.0 };
    shader.uniforms.uMetalnessIntensity = { value: data.ormIntensityMetalness ?? 1.0 };

    shader.fragmentShader = `
      uniform float uAoIntensity;
      uniform float uRoughnessIntensity;
      uniform float uMetalnessIntensity;
      ${shader.fragmentShader}
    `.replace(
      '#include <roughnessmap_fragment>',
      `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
        // Use GREEN channel for roughness and multiply by intensity
        roughnessFactor *= texelRoughness.g * uRoughnessIntensity;
      #endif
      `
    ).replace(
      '#include <metalnessmap_fragment>',
      `
      float metalnessFactor = metalness;
      #ifdef USE_METALNESSMAP
        vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
        // Use BLUE channel for metalness and multiply by intensity
        metalnessFactor *= texelMetalness.b * uMetalnessIntensity;
      #endif
      `
    ).replace(
      '#include <aomap_fragment>',
      `
      #ifdef USE_AOMAP
        // Use RED channel for AO and multiply by intensity
        float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * uAoIntensity + 1.0;
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          float dotNV = saturate( dot( geometry.normal, geometry.viewDir ) );
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
        #endif
      #endif
      `
    );

    material.userData.shader = shader;
  };
}

/**
 * Updates the uniforms of a material that has had ORM controls injected.
 */
export function updateORMUniforms(material: THREE.Material, data: MaterialData) {
  const shader = material.userData.shader;
  if (shader && shader.uniforms) {
    if (shader.uniforms.uAoIntensity) shader.uniforms.uAoIntensity.value = data.ormIntensityAO ?? 1.0;
    if (shader.uniforms.uRoughnessIntensity) shader.uniforms.uRoughnessIntensity.value = data.ormIntensityRoughness ?? 1.0;
    if (shader.uniforms.uMetalnessIntensity) shader.uniforms.uMetalnessIntensity.value = data.ormIntensityMetalness ?? 1.0;
  }
}

/**
 * Creates a Three.js material from MaterialData.
 */
export function createPBRMaterial(data: MaterialData): THREE.Material {
  if (data.isVolumetric || data.volumetric?.enabled) {
    const volConfig = {
      ...(data.volumetric || {}),
      color: data.color || data.volumetric?.color || '#ffffff',
    };
    return createRaymarchedCloudMaterial(volConfig);
  }

  const isVelvet = Boolean(
    (data.id && data.id.includes('velvet')) ||
    (data.name && data.name.toLowerCase().includes('terciopelo')) ||
    (data.name && data.name.toLowerCase().includes('velvet'))
  );

  const isIceMat = Boolean(
    data.isIce === true ||
    (data.id && (data.id.startsWith('ice_') || data.id.includes('ice_glacial') || data.id.includes('ice_frosted') || data.id.includes('ice_cracked') || data.id.includes('snow_ice'))) ||
    (data.name && (data.name.toLowerCase().includes('hielo') || data.name.toLowerCase().includes('glacial') || data.name.toLowerCase().includes('ice')))
  );

  const isGlassMat = Boolean(
    data.isGlass === true ||
    data.glassConfig?.enabled === true ||
    (data.id && (data.id.startsWith('glass_') || data.id.includes('glass_dispersion') || data.id.includes('prism_spectral'))) ||
    (data.name && (data.name.toLowerCase().includes('cristal webgpu') || data.name.toLowerCase().includes('prisma')))
  );

  const isCSMMat = Boolean(
    data.isCSM === true ||
    data.csmConfig?.enabled === true
  );

  const isPhysical = 
    (data.transmission ?? 0) > 0 || 
    (data.clearcoat ?? 0) > 0 || 
    (data.sheen ?? 0) > 0 || 
    (data.anisotropy ?? 0) > 0 ||
    (data.dispersion ?? 0) > 0 ||
    isVelvet ||
    isIceMat ||
    isGlassMat ||
    (data.iridescence ?? 0) > 0 ||
    (data.specularIntensity !== undefined && data.specularIntensity !== 1) ||
    (data.ior !== undefined && data.ior !== 1.5) ||
    (data.thickness !== undefined && data.thickness > 0);

  const material = isPhysical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  
  material.name = data.name || 'Material';
  material.color.set(data.color || '#ffffff');
  material.roughness = data.roughness ?? (isIceMat ? 0.08 : 0.5);
  material.metalness = data.metalness ?? 0;
  material.emissive.set(data.emissive || '#000000');
  material.emissiveIntensity = data.emissiveIntensity ?? 1;
  material.opacity = data.opacity ?? 1;
  // Note: For transmission materials, keeping transparent=false with depthWrite=true provides solid closed-mesh volumetric refraction
  material.transparent = data.transparent ?? (material.opacity < 1);
  material.depthWrite = true;
  material.side = THREE.DoubleSide;
  material.dithering = true;

  const albedoUrl = data.map || data.mapAlbedo;
  const normalUrl = data.normalMap || data.mapNormal;
  const roughnessUrl = data.roughnessMap || data.mapRoughness;
  const metalnessUrl = data.metalnessMap || data.mapMetalness;
  const aoUrl = data.aoMap || data.mapAO;
  const emissiveUrl = data.emissiveMap || data.mapEmissive;
  const displacementUrl = data.displacementMap || data.mapDisplacement;

  const loader = new THREE.TextureLoader();
  const loadTexture = (url: any, colorSpace: THREE.ColorSpace = THREE.NoColorSpace) => {
    if (!url) return null;
    if (url instanceof THREE.Texture) return url;
    if (typeof url !== 'string') return null;
    const tex = loader.load(url, (loadedTex) => {
      loadedTex.flipY = data.flipY ?? true;
      loadedTex.needsUpdate = true;
    });
    tex.colorSpace = colorSpace;
    tex.anisotropy = 16;
    tex.flipY = data.flipY ?? true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (data.mapRepeat) {
      const repX = Array.isArray(data.mapRepeat) ? data.mapRepeat[0] : data.mapRepeat;
      const repY = Array.isArray(data.mapRepeat) ? data.mapRepeat[1] : data.mapRepeat;
      tex.repeat.set(repX, repY);
    }
    if (data.mapOffset) {
      const offX = Array.isArray(data.mapOffset) ? data.mapOffset[0] : data.mapOffset;
      const offY = Array.isArray(data.mapOffset) ? data.mapOffset[1] : data.mapOffset;
      tex.offset.set(offX, offY);
    }
    if (data.mapRotation) tex.rotation = (data.mapRotation * Math.PI) / 180;
    return tex;
  };

  if (isPhysical) {
    const m = material as THREE.MeshPhysicalMaterial;
    m.ior = data.ior ?? (isIceMat ? 1.31 : 1.5);
    m.transmission = data.transmission ?? (isIceMat ? 0.98 : 0);
    if (data.transmissionMap) m.transmissionMap = loadTexture(data.transmissionMap);
    m.thickness = data.thickness ?? (isIceMat ? 1.8 : 0);
    if (data.thicknessMap) m.thicknessMap = loadTexture(data.thicknessMap);
    if ('dispersion' in m && (data.dispersion !== undefined || isIceMat)) {
      (m as any).dispersion = data.dispersion ?? (isIceMat ? 0.035 : 0);
    }
    m.attenuationDistance = data.attenuationDistance ?? (isIceMat ? 0.45 : Infinity);
    if (data.attenuationColor) {
      m.attenuationColor.set(data.attenuationColor);
    } else if (isIceMat) {
      m.attenuationColor.set('#0284c7');
    }
    
    // Clearcoat
    m.clearcoat = data.clearcoat ?? (isIceMat ? 0.95 : 0);
    m.clearcoatRoughness = data.clearcoatRoughness ?? (isIceMat ? 0.03 : 0);
    if (data.clearcoatMap) m.clearcoatMap = loadTexture(data.clearcoatMap);
    if (data.clearcoatRoughnessMap) m.clearcoatRoughnessMap = loadTexture(data.clearcoatRoughnessMap);
    m.clearcoatNormalMap = loadTexture(data.clearcoatNormalMap);
    if (data.clearcoatNormalScale) m.clearcoatNormalScale.set(data.clearcoatNormalScale, data.clearcoatNormalScale);
    
    // Sheen
    m.sheen = data.sheen ?? (isVelvet ? 1.0 : 0);
    m.sheenRoughness = data.sheenRoughness ?? 0.4;
    if (data.sheenColor) {
      m.sheenColor.set(data.sheenColor);
    } else if (isVelvet) {
      m.sheenColor.set('#ff9999');
    }
    if (data.sheenColorMap) m.sheenColorMap = loadTexture(data.sheenColorMap, THREE.SRGBColorSpace);
    if (data.sheenRoughnessMap) m.sheenRoughnessMap = loadTexture(data.sheenRoughnessMap);

    // Anisotropy
    if ('anisotropy' in m) {
      (m as any).anisotropy = data.anisotropy ?? 0;
      if (data.anisotropyRotation !== undefined) {
        (m as any).anisotropyRotation = (data.anisotropyRotation * Math.PI) / 180;
      }
      if (data.anisotropyMap) {
        (m as any).anisotropyMap = loadTexture(data.anisotropyMap);
      }
    }

    // Iridescence
    m.iridescence = data.iridescence ?? 0;
    m.iridescenceIOR = data.iridescenceIOR ?? 1.3;
    if (data.iridescenceThicknessRange) m.iridescenceThicknessRange = data.iridescenceThicknessRange;
    if (data.iridescenceMap) m.iridescenceMap = loadTexture(data.iridescenceMap);
    if (data.iridescenceThicknessMap) m.iridescenceThicknessMap = loadTexture(data.iridescenceThicknessMap);

    // Specular
    m.specularIntensity = data.specularIntensity ?? 1;
    if (data.specularColor) m.specularColor.set(data.specularColor);
  }

  material.map = loadTexture(albedoUrl, THREE.SRGBColorSpace);
  material.normalMap = loadTexture(normalUrl);
  
  // Normal Scale with DirectX / OpenGL format support (invert Y)
  const normScaleVal = data.normalScale ?? 1.0;
  const isDirectX = data.normalFormat === 'DIRECTX' || data.invertNormalY === true;
  material.normalScale.set(normScaleVal, isDirectX ? -normScaleVal : normScaleVal);
  
  if (data.useORM && data.ormMap) {
    const orm = loadTexture(data.ormMap);
    material.aoMap = orm;
    material.roughnessMap = orm;
    material.metalnessMap = orm;
    material.aoMapIntensity = data.aoMapIntensity ?? 1.0;
    injectORMControls(material, data);
  } else {
    material.roughnessMap = loadTexture(roughnessUrl);
    material.metalnessMap = loadTexture(metalnessUrl);
    material.aoMap = loadTexture(aoUrl);
    material.aoMapIntensity = data.aoMapIntensity ?? 1.0;
  }

  material.emissiveMap = loadTexture(emissiveUrl, THREE.SRGBColorSpace);
  material.alphaMap = loadTexture(data.alphaMap);
  material.displacementMap = loadTexture(displacementUrl);
  material.displacementScale = data.displacementScale ?? 0;
  material.displacementBias = data.displacementBias ?? 0;

  injectSeamlessDisplacement(material);

  if (isCSMMat && data.csmConfig) {
    return createCustomShaderMaterial(data.csmConfig, data, {
      map: material.map,
      normalMap: material.normalMap,
      roughnessMap: material.roughnessMap,
      metalnessMap: material.metalnessMap,
      aoMap: material.aoMap,
      emissiveMap: material.emissiveMap
    });
  }

  if (isGlassMat && material instanceof THREE.MeshPhysicalMaterial) {
    injectWebGPUGlassShader(material, data.glassConfig || { enabled: true });
  } else if (isIceMat && material instanceof THREE.MeshPhysicalMaterial) {
    injectProceduralIceShader(material, data);
  } else if (
    (typeof data.porosity === 'number' ? data.porosity > 0.001 : Boolean(data.porosity)) ||
    (data.porosityStrength ?? 0) > 0.001
  ) {
    injectPorosityControls(material as THREE.MeshStandardMaterial, data);
  }

  return material;
}

/**
 * Updates all time-dependent and dynamic shader uniforms (CSM, WebGPU Glass, Ice, etc.)
 */
export function updateAllMaterialUniforms(material: THREE.Material, time: number, data?: MaterialData) {
  if (!material || !material.userData) return;

  if (material.userData.isCSM) {
    updateCSMUniforms(material, time, data?.csmConfig);
  }
  if (material.userData.isWebGPUGlass) {
    updateWebGPUGlassUniforms(material, time, data?.glassConfig);
  }
  if (data?.useORM) {
    updateORMUniforms(material, data);
  }
}

/**
 * Common GLSL noise math for vertex & fragment shaders.
 */
const COMMON_NOISE_GLSL = `
  vec3 glsl_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 glsl_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 glsl_permute(vec4 x) { return glsl_mod289(((x*34.0)+1.0)*x); }
  vec4 glsl_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float glsl_snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = glsl_mod289(i);
    vec4 p = glsl_permute(glsl_permute(glsl_permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = glsl_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // Multi-octave 3D cellular / Voronoi noise for pores & micro-cavities
  float glsl_voronoiPores(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float minDist = 1.0;
    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 neighbor = vec3(float(x), float(y), float(z));
          vec3 cell = i + neighbor;
          vec3 h = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)),
                                  dot(cell, vec3(269.5, 183.3, 246.1)),
                                  dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
          vec3 pt = neighbor + h - f;
          float d = length(pt);
          if (d < minDist) {
            minDist = d;
          }
        }
      }
    }
    return minDist;
  }
`;

/**
 * Inyecta modulación procedural de Porosidad y Micro-rugosidad en materiales estándar y físicos.
 * Rompe el aspecto sintético demasiado liso y los reflejos especulares de espejo uniforme.
 */
export function injectPorosityControls(material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial, data: MaterialData) {
  const prevOnBefore = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    if (prevOnBefore) {
      prevOnBefore(shader, renderer);
    }

    const rawPorosity = data.porosity;
    const porosity = typeof rawPorosity === 'number' 
      ? rawPorosity 
      : (rawPorosity ? (data.porosityStrength ?? 0.65) : (data.porosityStrength ?? 0.0));
    
    const porosityScale = data.porosityScale ?? 18.0;
    const porosityRoughness = data.porosityMatteBias ?? data.porosityRoughness ?? 0.85;
    const porosityCavityDepth = data.porosityCavityDarkening ?? data.porosityCavityDepth ?? 0.35;
    const patchiness = data.porosityPatchiness ?? 0.65;
    const patchScale = data.porosityPatchScale ?? 3.0;
    const porosityCoverage = Math.min(Math.max(1.0 - patchiness * 0.7, 0.1), 1.0);

    shader.uniforms.uPorosity = { value: porosity };
    shader.uniforms.uPorosityScale = { value: porosityScale };
    shader.uniforms.uPorosityRoughness = { value: porosityRoughness };
    shader.uniforms.uPorosityCavityDepth = { value: porosityCavityDepth };
    shader.uniforms.uPorosityCoverage = { value: porosityCoverage };
    shader.uniforms.uPorosityPatchScale = { value: patchScale };

    shader.vertexShader = `
      varying vec3 vPorosityLocalPos;
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vPorosityLocalPos = position;
      `
    );

    shader.fragmentShader = `
      varying vec3 vPorosityLocalPos;
      uniform float uPorosity;
      uniform float uPorosityScale;
      uniform float uPorosityRoughness;
      uniform float uPorosityCavityDepth;
      uniform float uPorosityCoverage;
      uniform float uPorosityPatchScale;

      ${COMMON_NOISE_GLSL}

      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>

      if (uPorosity > 0.005) {
        vec3 pPore = vPorosityLocalPos * uPorosityScale;
        
        // 1. Parches de distribución (zonas con poros vs zonas más pulidas)
        float patchNoise = glsl_snoise(vPorosityLocalPos * uPorosityPatchScale) * 0.5 + 0.5;
        float patchMask = smoothstep(1.0 - uPorosityCoverage, 1.0, patchNoise);

        // 2. Micro-cavidades celulares y micro-poros
        float vPore = glsl_voronoiPores(pPore);
        float poreHole = 1.0 - smoothstep(0.0, 0.45, vPore);
        
        // 3. Microrugosidad fina fractal
        float fineGrain = glsl_snoise(pPore * 2.8) * 0.5 + 0.5;
        float ultraGrain = glsl_snoise(pPore * 7.5) * 0.5 + 0.5;
        float poreTexture = (poreHole * 0.7 + fineGrain * 0.2 + ultraGrain * 0.1);

        float finalPorosity = clamp(poreTexture * patchMask * uPorosity, 0.0, 1.0);

        // Oclusión suave de cavidades oscuras en el fondo del poro
        float cavityAO = 1.0 - (poreHole * patchMask * uPorosityCavityDepth * 0.55);
        diffuseColor.rgb *= cavityAO;
      }
      `
    ).replace(
      '#include <roughnessmap_fragment>',
      `
      #include <roughnessmap_fragment>

      if (uPorosity > 0.005) {
        vec3 pPore = vPorosityLocalPos * uPorosityScale;
        float patchNoise = glsl_snoise(vPorosityLocalPos * uPorosityPatchScale) * 0.5 + 0.5;
        float patchMask = smoothstep(1.0 - uPorosityCoverage, 1.0, patchNoise);
        float vPore = glsl_voronoiPores(pPore);
        float poreHole = 1.0 - smoothstep(0.0, 0.45, vPore);
        float fineGrain = glsl_snoise(pPore * 2.8) * 0.5 + 0.5;
        float poreFactor = clamp((poreHole * 0.75 + fineGrain * 0.25) * patchMask * uPorosity, 0.0, 1.0);

        // Aumentar rugosidad en poros para eliminar el brillo especular uniforme de plástico/espejo
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor = clamp(roughnessFactor + poreFactor * uPorosityRoughness, 0.02, 0.98);
        #else
          roughnessFactor = clamp(roughness + poreFactor * uPorosityRoughness, 0.02, 0.98);
        #endif
      }
      `
    ).replace(
      '#include <normal_fragment_begin>',
      `
      #include <normal_fragment_begin>

      if (uPorosity > 0.005 && uPorosityCavityDepth > 0.01) {
        vec3 pPore = vPorosityLocalPos * uPorosityScale;
        float eps = 0.08;
        float n0 = glsl_voronoiPores(pPore);
        float nx = glsl_voronoiPores(pPore + vec3(eps, 0.0, 0.0));
        float ny = glsl_voronoiPores(pPore + vec3(0.0, eps, 0.0));
        float nz = glsl_voronoiPores(pPore + vec3(0.0, 0.0, eps));
        
        vec3 poreGrad = vec3(nx - n0, ny - n0, nz - n0) / eps;
        float patchNoise = glsl_snoise(vPorosityLocalPos * uPorosityPatchScale) * 0.5 + 0.5;
        float patchMask = smoothstep(1.0 - uPorosityCoverage, 1.0, patchNoise);
        
        vec3 perturbedNormal = normalize(normal - poreGrad * (uPorosity * uPorosityCavityDepth * patchMask * 0.35));
        normal = perturbedNormal;
      }
      `
    );

    material.userData.shader = shader;
  };
}

/**
 * Procedural Ice & Frozen Core Shader Node Injection for MeshPhysicalMaterial.
 * Implements:
 * 1. [Voronoi/Perlin Noise] -> Surface organic deformation (wavy non-flat faces/edges)
 * 2. [3D Musgrave Noise]    -> Deep cloudy core, internal fractures & white air bubbles (Subsurface scattering)
 * 3. [Fresnel Facing Angle] -> Outer frost, rime accumulation on edges, higher rim roughness
 * 4. [Porosity & Pores]     -> Micro-cavities & localized porous matte patches to break excessive shine
 */
export function injectProceduralIceShader(material: THREE.MeshPhysicalMaterial, data: MaterialData) {
  const prevOnBefore = material.onBeforeCompile;
  const cfg = data.iceConfig || {};

  material.onBeforeCompile = (shader, renderer) => {
    if (prevOnBefore) {
      prevOnBefore(shader, renderer);
    }

    const icePorosity = cfg.porosity ?? data.porosity ?? 0.45;
    const icePorosityScale = cfg.porosityScale ?? data.porosityScale ?? 22.0;

    shader.uniforms.uIceWarp = { value: cfg.surfaceWarp ?? 0.045 };
    shader.uniforms.uIceCloudDensity = { value: cfg.cloudDensity ?? 1.4 };
    shader.uniforms.uIceCloudColor = { value: new THREE.Color(cfg.cloudColor || '#edf7fd') };
    shader.uniforms.uIceCloudScale = { value: cfg.cloudScale ?? 2.6 };
    shader.uniforms.uIceFrostIntensity = { value: cfg.frostIntensity ?? 0.85 };
    shader.uniforms.uIceCrackIntensity = { value: cfg.crackIntensity ?? 0.9 };
    shader.uniforms.uIcePorosity = { value: icePorosity };
    shader.uniforms.uIcePorosityScale = { value: icePorosityScale };

    // Common GLSL noise math for vertex & fragment shaders
    const commonNoiseGLSL = `
      vec3 ice_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 ice_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 ice_permute(vec4 x) { return ice_mod289(((x*34.0)+1.0)*x); }
      vec4 ice_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
      
      float ice_snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = ice_mod289(i);
        vec4 p = ice_permute(ice_permute(ice_permute(
                   i.z + vec4(0.0, i1.z, i2.z, 1.0))
                 + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                 + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = ice_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }

      float ice_voronoiPores(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        float minDist = 1.0;
        for (int z = -1; z <= 1; z++) {
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec3 neighbor = vec3(float(x), float(y), float(z));
              vec3 cell = i + neighbor;
              vec3 h = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)),
                                      dot(cell, vec3(269.5, 183.3, 246.1)),
                                      dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
              vec3 pt = neighbor + h - f;
              float d = length(pt);
              if (d < minDist) minDist = d;
            }
          }
        }
        return minDist;
      }
    `;

    // ── VERTEX SHADER INJECTION ──────────────────────────────────────────────
    shader.vertexShader = `
      varying vec3 vIceLocalPos;
      uniform float uIceWarp;
      ${commonNoiseGLSL}
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vIceLocalPos = position;
      
      // Node 1: Surface organic deformation (multi-frequency domain-warped organic displacement)
      if (uIceWarp > 0.001) {
        vec3 p = position;
        float w1 = ice_snoise(p * 1.4);
        float w2 = ice_snoise(p * 1.4 + vec3(4.3, 1.7, 8.2));
        float w3 = ice_snoise(p * 1.4 + vec3(7.1, 9.5, 3.4));
        vec3 warpedP = p + vec3(w1, w2, w3) * 0.35;
        
        float macroNoise = ice_snoise(warpedP * 1.6) * 0.65;
        float midNoise = ice_snoise(warpedP * 3.8) * 0.25;
        float fineNoise = ice_snoise(p * 9.0) * 0.10;
        float totalDeform = (macroNoise + midNoise + fineNoise);

        vec3 dispNorm = length(position) > 0.0001 ? normalize(position) : normalize(objectNormal);
        transformed += dispNorm * (totalDeform * uIceWarp);
      }
      `
    );

    // ── FRAGMENT SHADER INJECTION ────────────────────────────────────────────
    shader.fragmentShader = `
      varying vec3 vIceLocalPos;
      uniform float uIceWarp;
      uniform float uIceCloudDensity;
      uniform vec3 uIceCloudColor;
      uniform float uIceCloudScale;
      uniform float uIceFrostIntensity;
      uniform float uIceCrackIntensity;
      uniform float uIcePorosity;
      uniform float uIcePorosityScale;

      ${commonNoiseGLSL}

      float ice_musgrave3D(vec3 p) {
        float f = 0.0;
        float amp = 0.55;
        vec3 pos = p;
        for (int i = 0; i < 4; i++) {
          float n = abs(ice_snoise(pos));
          f += amp * n;
          pos *= 2.15;
          amp *= 0.5;
        }
        return f;
      }

      float ice_voronoi3DCracks(vec3 p) {
        float w = ice_snoise(p * 1.2) * 0.35;
        vec3 wp = p + vec3(w, -w * 0.8, w * 1.2);
        vec3 i = floor(wp);
        vec3 f = fract(wp);
        float minDist = 1.0;
        float secondMin = 1.0;
        for (int z = -1; z <= 1; z++) {
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec3 neighbor = vec3(float(x), float(y), float(z));
              vec3 cell = i + neighbor;
              vec3 h = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)),
                                      dot(cell, vec3(269.5, 183.3, 246.1)),
                                      dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
              vec3 pt = neighbor + h - f;
              float d = length(pt);
              if (d < minDist) {
                secondMin = minDist;
                minDist = d;
              } else if (d < secondMin) {
                secondMin = d;
              }
            }
          }
        }
        return secondMin - minDist;
      }

      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>

      // ── Node 2: 3D Musgrave Internal Core + Bubbles & Fractures ───────────
      float musgVal = ice_musgrave3D(vIceLocalPos * uIceCloudScale);
      float crackEdge = ice_voronoi3DCracks(vIceLocalPos * (uIceCloudScale * 2.3));
      float crackMask = 1.0 - smoothstep(0.015, 0.12, crackEdge);

      // Concentración radial del núcleo
      float distFromCenter = length(vIceLocalPos);
      float centerMask = smoothstep(1.15, 0.18, distFromCenter);
      float internalCloud = clamp(
        (musgVal * 0.82 + crackMask * 0.55 * uIceCrackIntensity) * centerMask * uIceCloudDensity,
        0.0,
        1.0
      );

      // CAMBIO 1: Sumamos el color de la nube de forma aditiva sobre el color base
      diffuseColor.rgb += uIceCloudColor * internalCloud * 0.45;

      // ── Node 3: Fresnel Facing Frost & Rime on Grazing Angles ─────────────
      vec3 vDir = normalize(vViewPosition);
      vec3 nDir = normalize(vNormal);
      float facingGrad = 1.0 - max(0.0, dot(nDir, -vDir));
      float fresnelFrost = pow(facingGrad, 2.6);
      float fineFrost = ice_snoise(vIceLocalPos * 22.0) * 0.5 + 0.5;
      float edgeFrost = fresnelFrost * (0.55 + 0.45 * fineFrost) * uIceFrostIntensity;

      // Añadimos la escarcha sin machacar el fondo
      diffuseColor.rgb += vec3(0.95, 0.98, 1.0) * edgeFrost * 0.35;

      // ── Node 4: Porosidad Glacial & Micro-cavidades para Romper Brillo ────
      float poreFactor = 0.0;
      if (uIcePorosity > 0.01) {
        vec3 pPore = vIceLocalPos * uIcePorosityScale;
        float patchNoise = ice_snoise(pPore * 0.2) * 0.5 + 0.5;
        float patchMask = smoothstep(0.35, 0.85, patchNoise);
        float vPore = ice_voronoiPores(pPore);
        float poreHole = 1.0 - smoothstep(0.0, 0.45, vPore);
        float fineGrain = ice_snoise(pPore * 3.0) * 0.5 + 0.5;
        poreFactor = clamp((poreHole * 0.75 + fineGrain * 0.25) * patchMask * uIcePorosity, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), poreFactor * 0.65);
      }

      // ── NUEVO - Node 5: Variación Dinámica por Espesor (Thickness) ──────────
      // Calculamos el ángulo de incidencia (1.0 en el centro visual, 0.0 en siluetas delgadas)
      float viewDotNormal = max(0.0, dot(nDir, vDir));
      float thicknessFactor = smoothstep(0.15, 0.80, viewDotNormal);

      // Paleta tonal realista: Azul marino profundo para masas pesadas
      vec3 colProfundo = vec3(0.02, 0.15, 0.35); // #022759
      vec3 colCristalinoBase = vec3(0.90, 0.96, 1.0); // #e5f5ff

      // Modulamos el Albedo: en bordes finos aclaramos el azul plano, concentrándolo en el núcleo
      vec3 tintedThicknessColor = mix(colCristalinoBase, diffuseColor.rgb, thicknessFactor);
      diffuseColor.rgb = mix(tintedThicknessColor, diffuseColor.rgb + colProfundo * (1.0 - thicknessFactor) * 0.2, thicknessFactor);
      `
    ).replace(
      '#include <roughnessmap_fragment>',
      `
      #include <roughnessmap_fragment>
      // Surface roughness modulation from facing frost, porosity and internal cloud scattering
      float addedRoughness = edgeFrost * 0.38 + internalCloud * 0.14 + (poreFactor * 0.85);
      #ifdef USE_ROUGHNESSMAP
        roughnessFactor = clamp(roughnessFactor + addedRoughness, 0.02, 0.98);
      #else
        roughnessFactor = clamp(roughness + addedRoughness, 0.02, 0.98);
      #endif
      `
    );

    material.userData.shader = shader;
  };
}

/**
 * Injects custom seamless displacement logic to prevent mesh face splitting at hard edges and corners.
 */
export function injectSeamlessDisplacement(material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial) {
  const previousOnBeforeCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    if (previousOnBeforeCompile) {
      previousOnBeforeCompile(shader, renderer);
    }

    if (shader.vertexShader.includes('#include <displacementmap_vertex>')) {
      const seamlessDisplacementCode = `
        #ifdef USE_DISPLACEMENTMAP
          vec3 smoothDispDir = length(position) > 0.0001 ? normalize(position) : normalize(objectNormal);

          vec3 bNorm = pow(abs(normalize(normal)), vec3(4.0));
          float totalNorm = bNorm.x + bNorm.y + bNorm.z + 0.00001;
          bNorm /= totalNorm;

          vec2 dispMapScale = vec2(1.0);
          #ifdef TRIPLANAR_SCALE
            dispMapScale = triplanarScale;
          #endif

          vec2 uvX = vec2(position.z * (normal.x < 0.0 ? -1.0 : 1.0), position.y);
          vec2 uvY = vec2(position.x, position.z * (normal.y < 0.0 ? -1.0 : 1.0));
          vec2 uvZ = vec2(position.x * (normal.z < 0.0 ? -1.0 : 1.0), position.y);

          float hX = texture2D(displacementMap, uvX * dispMapScale).x;
          float hY = texture2D(displacementMap, uvY * dispMapScale).x;
          float hZ = texture2D(displacementMap, uvZ * dispMapScale).x;
          float triHeight = hX * bNorm.x + hY * bNorm.y + hZ * bNorm.z;

          float stdHeight = texture2D( displacementMap, vDisplacementMapUv ).x;
          float finalHeight = mix(stdHeight, triHeight, 0.65);

          transformed += smoothDispDir * ( finalHeight * displacementScale + displacementBias );
        #endif
      `;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <displacementmap_vertex>',
        seamlessDisplacementCode
      );
    }

    material.userData.shader = shader;
  };
}
