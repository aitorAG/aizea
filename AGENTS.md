# AIzea - Reglas del proyecto

## Reglas de flujo de trabajo (OBLIGATORIAS)

### Versionado
- **SIEMPRE que termines de implementar una feature o cambio significativo, ACTUALIZA la versión** en `aizea/package.json` (campo `version`).
  - `tauri.conf.json` hereda la versión de `package.json` automáticamente, así que solo hay que tocar `package.json`.
  - Usa versionado semántico:
    - **patch** (0.9.1 → 0.9.2): bugfixes, cambios menores.
    - **minor** (0.9.1 → 0.10.0): features nuevas.
    - **major** (0.9.1 → 1.0.0): cambios que rompen compatibilidad o primera release estable.
  - Hazlo ANTES de que el usuario genere el MSI, no después.

### Build y verificación
- El comando de build es `npm run build` (dentro de `aizea/`). Tarda ~2 min.
- Migraciones Prisma: `npx prisma migrate dev` (dentro de `aizea/`).
- El proyecto es **type-safe estricto**: prohibido `as any`, `@ts-ignore`, `@ts-expect-error`.

### Procesos largos
- Avisar al usuario antes de ejecutar procesos largos (generación del instalador MSI, etc.). El usuario prefiere ejecutar el MSI él mismo.

## Notas del schema
- El campo de numeración jerárquica en `Slide` se llama `numericPath` (formato `"1.2.3"`), NO `hierarchicalNumber`.
- El campo `status` en `Slide` es un `String` (no un enum de Prisma). No importar `SlideStatus` de `@prisma/client`.
