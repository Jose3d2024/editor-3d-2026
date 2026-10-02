# Fix de bloqueo durante Optimizar

Fecha: 2026-10-02

## Diagnóstico

La ruta actual de `optimizeObject()` en `src/store/useStore.ts` no utiliza `optimizeMesh()` como se había asumido inicialmente. Para objetos nativos llama a `simplifyMesh()` de `src/utils/modifiers_advanced.ts`; para modelos GLTF/GLB llama a `optimizeGLBModel()`.

La ruta nativa de `simplifyMesh()` construye arrays completos de índices/posiciones, espera la inicialización de Meshopt y realiza varios intentos síncronos de `Meshopt.simplify()` / `Meshopt.simplifyWithAttributes()`. Con una malla grande todo ese trabajo ocurre en el hilo principal si se invoca desde Zustand/UI.

La ruta GLTF/GLB es todavía más pesada: usa glTF-Transform, `weld()`, Meshopt y, para modelos no animados, reorder + Draco + escritura del GLB. Esa ruta también necesita tratamiento separado y no se debe mezclar con el Worker nativo sin comprobar compatibilidad de sus dependencias WASM.

## Cambios realizados

### 1. `src/utils/optimizationWorker.ts`

El Worker se corrigió para utilizar la función real que emplea el botón Optimizar para mallas nativas: `simplifyMesh(object, ratio)`.

La primera versión utilizaba `optimizeMesh()`, que no era la ruta real del botón.

### 2. `src/utils/optimizationWorkerClient.ts`

Se añadió un cliente que crea un Worker de módulo, asigna un ID único, devuelve una Promise con `vertices` y `faces`, termina el Worker al finalizar, propaga errores y limita el ratio a `0.01–0.99`.

## Estado actual

El Worker y su cliente ya están preparados, pero todavía no se ha conectado `optimizeObject()` de `useStore.ts` al cliente. No se marca como completado porque esa conexión debe mantener correctamente `meshProcessing`, `saveHistory()`, Undo/Redo y la rama GLTF/GLB.

## Próximo cambio

Modificar únicamente la rama de malla nativa de `optimizeObject()` para utilizar `optimizeMeshInWorker(updatedObj, ratio)`, manteniendo en el hilo principal solo la preparación mínima, recepción del resultado, una actualización de `project.objects`, `saveHistory()` y el estado final de `meshProcessing`.

Después se estudiará por separado `optimizeGLBModel()` antes de mover esa ruta a Worker.

## Seguridad prevista

- No permitir dos optimizaciones simultáneas del mismo objeto.
- No reemplazar la geometría si el Worker devuelve datos vacíos o inválidos.
- Mantener el objeto original si falla el Worker.
- Mantener Undo/Redo creando el historial únicamente después de recibir un resultado válido.
- Añadir cancelación explícita en el siguiente paso.

## Commits

- `954d19ab6f957d721bc826bff12106ef576493ea` — `perf: add isolated mesh optimization worker`
- `bbb9899511783d180d3278197a495fd011bee83d` — `fix: worker uses actual mesh simplifier`
- `0baed77fc42edbe06f65bdceeeed4059565474bd` — `feat: add optimization worker client`
