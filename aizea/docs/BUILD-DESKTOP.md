# Build Desktop - AIzea

Guía para compilar la aplicación de escritorio AIzea con Tauri.

## Requisitos

- **Rust** >= 1.77.2 (recomendado 1.97+)
- **Node.js** >= 18
- **Tauri CLI** (instalado automáticamente vía npm)
- Dependencias del sistema según plataforma:
  - **Windows**: Microsoft Visual C++ Build Tools
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`

## Pasos de build

1. Clonar el repositorio:
   ```bash
   git clone <repo-url>
   cd aizea
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Compilar la aplicación:
   ```bash
   npm run tauri build
   ```

## Estructura de salida

Los artefactos se generan en:

```
src-tauri/target/release/bundle/
```

Subdirectorios por formato:
- `msi/` - Instalador Windows (.msi)
- `dmg/` - Imagen de disco macOS (.dmg)
- `appimage/` - AppImage Linux
- `deb/` - Paquete Debian (.deb)
- `rpm/` - Paquete RPM (.rpm)
- `app/` - Aplicación macOS (.app)

## Notas por plataforma

### Windows
- Genera un instalador `.msi` por defecto.
- Requiere herramientas de build de MSVC.
- No se firman binarios sin certificados de código.

### macOS
- Genera `.app` y `.dmg`.
- Requiere Xcode Command Line Tools.
- Para notarización y distribución fuera de la Mac App Store se necesita una cuenta de desarrollador de Apple.

### Linux
- Genera `.AppImage`, `.deb` y `.rpm`.
- Las dependencias de sistema varían según la distribución.
- AppImage es el formato más portable.

## Auto-updater

El auto-updater se **eliminó** del proyecto (uso no comercial): no hay `tauri-plugin-updater` ni firma de releases. Para actualizar, se recompila y reinstala el MSI. Si en el futuro se necesitara, habría que reañadir el plugin, un servidor/URL de updates, y firma con clave privada + certificado. Ver `README.SECURITY.md` en la raíz.

## Verificación

Antes de build, validar que el proyecto compila:

```bash
cd src-tauri
cargo check
```

## No incluido en este pipeline

- Firma de binarios con certificados
- Publicación en tiendas de aplicaciones
- Notarización de macOS
