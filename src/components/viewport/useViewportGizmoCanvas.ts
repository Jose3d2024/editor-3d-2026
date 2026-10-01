import React, { useEffect } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store/useStore';
import { computeGizmoLayout } from './viewportGizmoMath';
import { evaluateCameraTransform, getInterpolatedTransform } from '../../utils/cameraPathHelper';

interface UseViewportGizmoCanvasOptions {
  gizmoCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.RefObject<THREE.Camera | null>;
  projectRef: React.RefObject<any>;
  gizmoStateRef: React.RefObject<any>;
  marqueeRef: React.RefObject<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>;
  getObjectMesh: (id: string | null | undefined) => THREE.Mesh | undefined;
  currentTime: number;
  selectedObjectId: string | null;
  selectedLightId: string | null;
  selectedCameraId: string | null;
  editMode: string;
  transformMode: string;
  transformSpace: string;
  selectedVertexIndices: number[];
}

export const useViewportGizmoCanvas = ({
  gizmoCanvasRef,
  rendererRef,
  cameraRef,
  projectRef,
  gizmoStateRef,
  marqueeRef,
  getObjectMesh,
  currentTime,
  selectedObjectId,
  selectedLightId,
  selectedCameraId,
  editMode,
  transformMode,
  transformSpace,
  selectedVertexIndices,
}: UseViewportGizmoCanvasOptions) => {
  useEffect(() => {
    const canvas = gizmoCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawGizmo = () => {
      const renderer = rendererRef.current;
      const w = renderer ? renderer.domElement.clientWidth : canvas.width;
      const h = renderer ? renderer.domElement.clientHeight : canvas.height;
      canvas.width = w || canvas.width;
      canvas.height = h || canvas.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // ── 1. Draw marquee selection box (always, regardless of selection state) ──
      if (marqueeRef.current) {
        const mb = marqueeRef.current;
        ctx.save();
        ctx.strokeStyle = '#4488ff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(mb.start.x, mb.start.y, mb.end.x - mb.start.x, mb.end.y - mb.start.y);
        ctx.fillStyle = 'rgba(68, 136, 255, 0.08)';
        ctx.fillRect(mb.start.x, mb.start.y, mb.end.x - mb.start.x, mb.end.y - mb.start.y);
        ctx.restore();
      }

      // ── 2. Draw Lathe Virtual Rotation Axis Line & Interactive Handle ──
      const curLathe = useStore.getState().latheConfig;
      if (curLathe && curLathe.active && cameraRef.current && renderer) {
        const cam = cameraRef.current;
        const axisPos = curLathe.axisPos || 0;
        let pTop3D = new THREE.Vector3();
        let pBot3D = new THREE.Vector3();

        if (curLathe.axis === 'y') {
          pTop3D.set(axisPos, 50, 0);
          pBot3D.set(axisPos, -50, 0);
        } else if (curLathe.axis === 'x') {
          pTop3D.set(-50, axisPos, 0);
          pBot3D.set(50, axisPos, 0);
        } else {
          pTop3D.set(axisPos, 0, 50);
          pBot3D.set(axisPos, 0, -50);
        }

        const ndcTop = pTop3D.clone().project(cam);
        const ndcBot = pBot3D.clone().project(cam);

        if (ndcTop.z <= 1.2 && ndcBot.z <= 1.2) {
          const sTopX = (ndcTop.x * 0.5 + 0.5) * w;
          const sTopY = (ndcTop.y * -0.5 + 0.5) * h;
          const sBotX = (ndcBot.x * 0.5 + 0.5) * w;
          const sBotY = (ndcBot.y * -0.5 + 0.5) * h;

          ctx.save();

          // Dark outer stroke
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
          ctx.lineWidth = 4.5;
          ctx.beginPath();
          ctx.moveTo(sTopX, sTopY);
          ctx.lineTo(sBotX, sBotY);
          ctx.stroke();

          // Glowing dashed gold line
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.2;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(sTopX, sTopY);
          ctx.lineTo(sBotX, sBotY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Central draggable handle badge
          const hX = Math.max(90, Math.min(w - 90, (sTopX + sBotX) * 0.5));
          const hY = Math.max(35, Math.min(h - 35, (sTopY + sBotY) * 0.5));

          const badgeWidth = 156;
          const badgeHeight = 26;
          const bx = hX - badgeWidth / 2;
          const by = hY - badgeHeight / 2;

          ctx.shadowColor = 'rgba(245, 158, 11, 0.45)';
          ctx.shadowBlur = 10;
          ctx.fillStyle = '#18181b';
          ctx.beginPath();
          ctx.roundRect(bx, by, badgeWidth, badgeHeight, 13);
          ctx.fill();

          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#fef3c7';
          ctx.font = 'bold 10px monospace, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`⟲ EJE (${curLathe.axis.toUpperCase()}:${axisPos.toFixed(2)}) ◀▶`, hX, hY);

          ctx.restore();
        }
      }

      if (!selectedObjectId && !selectedLightId && !selectedCameraId) return;

      const selObj = selectedObjectId ? projectRef.current?.objects?.find((o: any) => o.id === selectedObjectId) : null;
      let gizmoPos = new THREE.Vector3();

      if (selectedLightId) {
        const l = projectRef.current?.lights?.find((l: any) => l.id === selectedLightId);
        if (!l || !cameraRef.current || !renderer) return;
        gizmoPos.fromArray(l.transform.position);
      } else if (selectedCameraId) {
        const c = projectRef.current?.cameras?.find((c: any) => c.id === selectedCameraId);
        if (!c || !cameraRef.current || !renderer) return;
        const evalCam = evaluateCameraTransform(c, projectRef.current?.objects || [], currentTime, projectRef.current?.duration || 5);
        gizmoPos.copy(evalCam.position);
      } else if (selectedObjectId) {
        if (!selObj || !cameraRef.current || !renderer) return;

        const mesh = getObjectMesh(selectedObjectId);

        if (selObj.nurbsSurface || selObj.nurbsCurve) {
          const isNurbsCp = !!(selObj.selectedNurbsControlPoint || selObj.selectedNurbsControlPoints?.length);
          if (isNurbsCp && (editMode === 'VERTEX' || isNurbsCp)) {
            const selCPs = selObj.selectedNurbsControlPoints?.length
              ? selObj.selectedNurbsControlPoints
              : (selObj.selectedNurbsControlPoint ? [selObj.selectedNurbsControlPoint] : []);
            const centroidLocal = new THREE.Vector3();
            let validCount = 0;
            selCPs.forEach((cp: any) => {
              let pt: [number, number, number] | null = null;
              if (selObj.nurbsSurface) {
                pt = selObj.nurbsSurface.controlPoints[cp.u]?.[cp.v ?? 0]?.point || null;
              } else if (selObj.nurbsCurve) {
                pt = selObj.nurbsCurve.controlPoints[cp.u]?.point || null;
              }
              if (pt) {
                centroidLocal.add(new THREE.Vector3(...pt));
                validCount++;
              }
            });
            if (validCount > 0) centroidLocal.divideScalar(validCount);
            if (mesh && validCount > 0) {
              gizmoPos = centroidLocal.applyMatrix4(mesh.matrixWorld);
            } else if (validCount > 0) {
              const _interp = getInterpolatedTransform(selObj, currentTime);
              gizmoPos = centroidLocal
                .multiply(new THREE.Vector3(..._interp.scale))
                .applyEuler(new THREE.Euler(..._interp.rotation))
                .add(new THREE.Vector3(..._interp.position));
            } else if (mesh) {
              mesh.getWorldPosition(gizmoPos);
            } else {
              const _interp = getInterpolatedTransform(selObj, currentTime);
              gizmoPos.fromArray(_interp.position);
            }
          } else if (mesh) {
            mesh.getWorldPosition(gizmoPos);
          } else {
            const _interp = getInterpolatedTransform(selObj, currentTime);
            gizmoPos.fromArray(_interp.position);
          }
        } else if (['VERTEX', 'FACE', 'EDGE'].includes(editMode)) {
          if (!selectedVertexIndices.length) return;

          const isShape = selObj.type === 'SHAPE';
          const isBezier = isShape && selObj.parameters?.shapeType === 'bezier';

          if (isBezier && selectedVertexIndices.some(idx => idx >= 10000)) {
            const idx = selectedVertexIndices[0];
            const anchorIdx = idx >= 20000 ? idx - 20000 : idx - 10000;
            const side = idx >= 20000 ? 'in' : 'out';
            const anchor = new THREE.Vector3(...selObj.vertices[anchorIdx]);
            const handleRel = new THREE.Vector3(...(selObj.bezierHandles?.[anchorIdx]?.[side] ?? [0, 0, 0]));
            if (mesh) {
              gizmoPos = anchor.add(handleRel).applyMatrix4(mesh.matrixWorld);
            } else {
              const _interp = getInterpolatedTransform(selObj, currentTime);
              gizmoPos = anchor.add(handleRel)
                .multiply(new THREE.Vector3(..._interp.scale))
                .applyEuler(new THREE.Euler(..._interp.rotation))
                .add(new THREE.Vector3(..._interp.position));
            }
          } else {
            const centroid = new THREE.Vector3();
            let count = 0;
            selectedVertexIndices.forEach(idx => {
              if (selObj.vertices && idx < selObj.vertices.length) {
                const v = selObj.vertices[idx];
                const off = selObj.vertexOffsets?.[idx] ?? [0, 0, 0];
                centroid.add(new THREE.Vector3(v[0] + off[0], v[1] + off[1], v[2] + off[2]));
                count++;
              }
            });
            if (count > 0) {
              centroid.divideScalar(count);
              if (mesh) {
                gizmoPos = centroid.applyMatrix4(mesh.matrixWorld);
              } else {
                const _interp = getInterpolatedTransform(selObj, currentTime);
                gizmoPos = centroid
                  .multiply(new THREE.Vector3(..._interp.scale))
                  .applyEuler(new THREE.Euler(..._interp.rotation))
                  .add(new THREE.Vector3(..._interp.position));
              }
            } else {
              return;
            }
          }
        } else {
          // OBJECT mode: Use the mesh's world position
          if (mesh) {
            mesh.getWorldPosition(gizmoPos);
          } else {
            const _interp = getInterpolatedTransform(selObj, currentTime);
            gizmoPos.fromArray(_interp.position);
          }
        }
      }

      const isNurbsCpSelected = !!(
        selObj &&
        (selObj.nurbsSurface || selObj.nurbsCurve) &&
        (selObj.selectedNurbsControlPoint || selObj.selectedNurbsControlPoints?.length)
      );

      const layout = computeGizmoLayout(gizmoPos, cameraRef.current, w, h, transformSpace, selObj, isNurbsCpSelected ? 50 : undefined, transformMode);
      if (!layout) return;
      const { cx, cy, AXIS_LEN, dirs, rotArcs } = layout;
      const gs = gizmoStateRef.current || {};

      const showTranslate = isNurbsCpSelected ? true : (transformMode === 'translate' || transformMode === 'universal');
      const showRotate = isNurbsCpSelected ? false : (transformMode === 'rotate' || transformMode === 'universal');
      const showScale = isNurbsCpSelected ? false : (transformMode === 'scale' || transformMode === 'universal');
      const showPlanes = isNurbsCpSelected ? true : (transformMode === 'translate' || transformMode === 'universal');
      const showOuterRing = !isNurbsCpSelected && (transformMode === 'rotate' || transformMode === 'universal' || transformMode === 'scale');

      // 1. Draw 2D translation corner plane handles
      if (showPlanes) {
        const drawPlane = (a1: string, a2: string, planeName: string, color: string) => {
          const d1 = dirs[a1], d2 = dirs[a2];
          if (!d1 || !d2) return;
          const isHov = gs.hoveredAxis === planeName || gs.activeAxis === planeName;
          ctx.save();
          ctx.globalAlpha = isHov ? 0.5 : 0.18;
          ctx.fillStyle = color;
          ctx.beginPath();
          const p1x = cx + d1.nx * 0.2, p1y = cy + d1.ny * 0.2;
          const p2x = cx + d1.nx * 0.42, p2y = cy + d1.ny * 0.42;
          const p3x = cx + (d1.nx + d2.nx) * 0.42, p3y = cy + (d1.ny + d2.ny) * 0.42;
          const p4x = cx + d2.nx * 0.42, p4y = cy + d2.ny * 0.42;
          const p5x = cx + d2.nx * 0.2, p5y = cy + d2.ny * 0.2;
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(p2x, p2y);
          ctx.lineTo(p3x, p3y);
          ctx.lineTo(p4x, p4y);
          ctx.lineTo(p5x, p5y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = isHov ? '#ffffff' : color;
          ctx.lineWidth = 1.0;
          ctx.stroke();
          ctx.restore();
        };

        drawPlane('X', 'Y', 'XY', '#f59e0b');
        drawPlane('Y', 'Z', 'YZ', '#06b6d4');
        drawPlane('X', 'Z', 'XZ', '#ec4899');
      }

      // 2. Draw Rotation Arcs
      if (showRotate) {
        for (const rotAxis of ['Z', 'X', 'Y']) {
          const arc = rotArcs[rotAxis];
          if (!arc || !arc.pts.length) continue;
          const isHov = gs.hoveredAxis === `ROT_${rotAxis}` || gs.activeAxis === `ROT_${rotAxis}`;

          ctx.save();
          ctx.globalAlpha = isHov ? 1.0 : 0.85;
          ctx.strokeStyle = arc.arcColor;
          ctx.lineWidth = isHov ? 2.0 : 1.2;

          ctx.beginPath();
          ctx.moveTo(arc.pts[0].x, arc.pts[0].y);
          for (let i = 1; i < arc.pts.length; i++) {
            ctx.lineTo(arc.pts[i].x, arc.pts[i].y);
          }
          ctx.stroke();

          // Spherical node handle on arc frontmost point
          const nodeR = isHov ? 6.5 : 4.5;
          ctx.fillStyle = arc.sphereColor;
          ctx.beginPath();
          ctx.arc(arc.handlePt.x, arc.handlePt.y, nodeR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.0;
          ctx.stroke();

          ctx.restore();
        }
      }

      // 3. Draw Axis Lines & Shafts (Translate / Scale)
      if (showTranslate || showScale) {
        for (const axis of ['X', 'Y', 'Z']) {
          const d = dirs[axis];
          if (!d) continue;
          const tipX = cx + d.nx, tipY = cy + d.ny;
          const isHov = gs.hoveredAxis === axis || gs.activeAxis === axis;

          ctx.save();
          ctx.globalAlpha = isHov ? 1.0 : 0.9;
          ctx.strokeStyle = d.color;
          ctx.lineWidth = isHov ? 2.0 : 1.2;
          ctx.lineCap = 'round';

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Arrowheads for Translate / Universal
          if (showTranslate) {
            const angle = Math.atan2(d.ny, d.nx);
            const al = 7.5;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - al * Math.cos(angle - 0.35), tipY - al * Math.sin(angle - 0.35));
            ctx.lineTo(tipX - al * Math.cos(angle + 0.35), tipY - al * Math.sin(angle + 0.35));
            ctx.closePath();
            ctx.fillStyle = d.color;
            ctx.fill();
          }

          // Clean, unblocked axis label badge positioned past all handles
          const labelDistRatio = 1.22;
          const labelX = cx + d.nx * labelDistRatio;
          const labelY = cy + d.ny * labelDistRatio;

          ctx.save();
          ctx.beginPath();
          ctx.arc(labelX, labelY, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = isHov ? d.color : '#18181b';
          ctx.fill();
          ctx.strokeStyle = isHov ? '#ffffff' : d.color;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.font = 'bold 9.5px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isHov ? '#ffffff' : d.color;
          ctx.fillText(axis, labelX, labelY + 0.5);
          ctx.restore();

          ctx.restore();
        }
      }

      // 4. Draw Scale Cubes
      if (showScale) {
        for (const axis of ['X', 'Y', 'Z']) {
          const d = dirs[axis];
          if (!d) continue;
          const scaleName = `SCALE_${axis}`;
          const isHov = gs.hoveredAxis === scaleName || gs.activeAxis === scaleName || (transformMode === 'scale' && (gs.hoveredAxis === axis || gs.activeAxis === axis));
          const scaleDistRatio = transformMode === 'universal' ? 0.72 : 1.0;
          const cubeX = cx + d.nx * scaleDistRatio;
          const cubeY = cy + d.ny * scaleDistRatio;
          const sz = isHov ? 9.5 : 7.0;
          ctx.save();
          ctx.fillStyle = d.color;
          ctx.fillRect(cubeX - sz / 2, cubeY - sz / 2, sz, sz);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(cubeX - sz / 2, cubeY - sz / 2, sz, sz);
          ctx.restore();
        }
      }

      // 5. Draw Outer Trackball Ring
      if (showOuterRing) {
        const OUTER_R = AXIS_LEN * 1.15;
        const isOuterHov = gs.hoveredAxis === 'ROT_VIEW' || gs.activeAxis === 'ROT_VIEW' || gs.hoveredAxis === 'SCALE_UNIFORM' || gs.activeAxis === 'SCALE_UNIFORM';
        ctx.save();
        ctx.globalAlpha = isOuterHov ? 0.85 : 0.25;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = isOuterHov ? 1.5 : 0.9;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, OUTER_R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 6. Draw center FREE handle
      const isFreeHov = gs.hoveredAxis === 'FREE' || gs.activeAxis === 'FREE';
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, isFreeHov ? 5.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isFreeHov ? '#ffffff' : '#e4e4e7';
      ctx.fill();
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    };

    let rafId: number;
    const loop = () => {
      drawGizmo();
      rafId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(rafId);
  }, [
    selectedObjectId,
    selectedLightId,
    selectedCameraId,
    editMode,
    transformMode,
    transformSpace,
    selectedVertexIndices,
    currentTime,
  ]);
};
