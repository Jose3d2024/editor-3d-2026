# Fix de bloqueo durante Optimizar

Fecha: 2026-10-02

## Diagnóstico

La ruta actual de optimización ejecuta `optimizeMesh(...)` directamente desde el estado de Zustand. La implementación de `optimizeMesh` convierte la malla a `BufferGeometry`, ejecuta `BufferGeometryUtils.mergeVertices(...)` y después `SimplifyModifier.modify(...)`. Estas operaciones son síncronas y pueden consumir mucho tiempo con mallas grandes. Además, el flujo recalcula normales con `computeVertexNormals()` y convierte de nuevo la geometría a `{ vertices, faces }`.

Referencias revisadas:
- `src/store/useStore.ts`: la optimización llama directamente a `optimizeMesh(...)`.
- `src/utils/modifiers.ts`: `optimizeMesh()` usa `mergeVertices`, `SimplifyModifier.modify` y `computeVertexNormals`.

## Cambio realizado

Se añadió:

`src/utils/optimizationWorker.ts`

Este Worker encapsula la ejecución pesada de `optimizeMesh()` fuera del hilo principal.

## Importante

El Worker está añadido de forma aislada para no alterar todavía el comportamiento del editor sin una prueba. El siguiente paso es conectar la llamada de `useStore.ts` a este Worker y añadir:

1. progreso real por fases;
2. cancelación;
3. protección para mallas extremadamente grandes;
4. aplicación del resultado una sola vez al finalizar;
5. fallback controlado si Worker no está disponible;
6. comprobación de que Undo/Redo conserva el estado anterior.

## Por qué no se hizo un cambio mayor automáticamente

`useStore.ts` contiene una parte importante de la lógica de edición y la llamada actual está integrada con el estado `meshProcessing`. Cambiar toda la ruta de una sola vez sin ejecutar el build/pruebas podría introducir regresiones. Por eso primero se aisló el trabajo pesado en un Worker.

## Estado

- [x] Identificada la operación síncrona pesada.
- [x] Worker creado.
- [ ] Conectar Worker con `useStore.ts`.
- [ ] Añadir cancelación.
- [ ] Añadir progreso por fases.
- [ ] Ejecutar `npm run lint`.
- [ ] Ejecutar `npm run build`.
- [ ] Probar con cubo, malla media y malla pesada.

## Commits

- `954d19ab6f957d721bc826bff12106ef576493ea` — `perf: add isolated mesh optimization worker`
