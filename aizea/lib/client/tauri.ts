// Detección de runtime Tauri, centralizada.
//
// El objeto global `__TAURI__` lo inyecta el runtime de Tauri en el webview.
// Antes cada componente hacía `(window as any).__TAURI__`; este helper tipa el
// acceso sin suprimir el type-checking.

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as { __TAURI__?: unknown }).__TAURI__);
}
