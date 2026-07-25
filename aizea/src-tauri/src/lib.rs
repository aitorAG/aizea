/// AIzea — Tauri entry point.
///
/// In production the Rust process:
///   1. Resolves the writable app-data directory (e.g. %APPDATA%\AIzea)
///   2. Creates required sub-directories (uploads/, lancedb-data/)
///   3. Spawns the bundled Node.js server (`node server.js`) with the
///      right environment variables so all mutable data lands in the
///      app-data directory (not inside Program Files).
///   4. Opens the main window pointing at http://localhost:1422
///
/// In development (`beforeDevCommand = "pnpm dev"`) the window opens
/// against the dev URL; no Node.js process is managed here.

#[cfg_attr(mobile, tauri::mobile_entry_point)]

mod pdf_parser;

use tauri::{Emitter, Manager};

#[tauri::command]
async fn extract_pdf(data: String) -> Result<pdf_parser::PdfData, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    let bytes = BASE64.decode(&data).map_err(|e| format!("Invalid base64: {}", e))?;
    let temp_path = std::env::temp_dir().join(format!("aizea_pdf_{}.pdf", std::process::id()));
    std::fs::write(&temp_path, &bytes).map_err(|e| format!("Failed to write temp file: {}", e))?;
    let result = pdf_parser::parse_pdf(temp_path.to_str().unwrap())?;
    std::fs::remove_file(&temp_path).ok();
    Ok(result)
}

#[tauri::command]
async fn save_file(path: String, data: String) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .blocking_pick_file();
    Ok(path.map(|p| p.to_string()))
}

/// Find `node` or `node.exe` on PATH or next to the current executable.
fn resolve_node_binary() -> String {
    // 1. Check next to the executable (bundled Node in future packaging)
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe.parent().unwrap_or(std::path::Path::new(".")).join("node.exe");
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
        let candidate = exe.parent().unwrap_or(std::path::Path::new(".")).join("node");
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    // 2. Fall back to PATH-resolved `node`
    "node".to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // --- Desktop-mode: start the Next.js server ---------------
            #[cfg(not(debug_assertions))]
            {
                use std::process::Command;

                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .expect("Cannot resolve app data dir");

                // Ensure writable sub-directories exist
                std::fs::create_dir_all(app_data_dir.join("uploads")).ok();
                std::fs::create_dir_all(app_data_dir.join("lancedb-data")).ok();

                // Resolve the bundled standalone server + sidecar node.
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("Cannot resolve resource dir");
                let server_js = resource_dir.join("standalone").join("server.js");

                // Windows verbatim-path fix: Tauri's `resource_dir()`
                // returns an extended-length path prefixed with `\\?\`
                // (e.g. `\\?\C:\Users\...`). Node.js does NOT understand
                // that prefix — passed as `process.argv[1]` it fails to
                // resolve the entry module and truncates to `C:`, throwing
                // `EISDIR: illegal operation on a directory, lstat 'C:'`.
                // We strip the prefix so Node receives a plain
                // `C:\Users\...\server.js` path it can stat.
                fn strip_verbatim(p: &std::path::Path) -> String {
                    let s = p.to_string_lossy().into_owned();
                    s.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(s)
                }

                // The sidecar node binary is placed next to the main exe
                // by Tauri, named `node.exe` (target-triple suffix stripped).
                let exe_dir = std::env::current_exe()
                    .expect("Cannot find current exe")
                    .parent()
                    .expect("No parent dir")
                    .to_path_buf();
                let mut node_bin = exe_dir.join("node.exe");
                if !node_bin.exists() {
                    // Fallback to PATH-resolved node
                    node_bin = std::path::PathBuf::from(resolve_node_binary());
                }

                // Strip the `\\?\` verbatim prefix from every path we hand
                // to the child Node process (entry script, data dir, DB
                // URL). Node cannot parse the extended-length form.
                let data_dir_str = strip_verbatim(&app_data_dir);
                let server_js_str = strip_verbatim(&server_js);
                let node_bin_clean = strip_verbatim(&node_bin);
                let db_url = format!(
                    "file:{}/db.sqlite",
                    data_dir_str.replace('\\', "/")
                );

                // First-run: seed an empty DB by running prisma migrate is
                // not available offline, so we ship a pre-migrated db.sqlite
                // as a resource and copy it on first launch.
                let db_target = app_data_dir.join("db.sqlite");
                if !db_target.exists() {
                    let seed = resource_dir.join("standalone").join("db.sqlite");
                    if seed.exists() {
                        std::fs::copy(&seed, &db_target).ok();
                    }
                }

                log::info!("[AIzea] node: {}", node_bin.to_string_lossy());
                log::info!("[AIzea] server.js: {}", server_js_str);
                log::info!("[AIzea] data dir: {}", data_dir_str);

                let child = Command::new(&node_bin_clean)
                    .arg(&server_js_str)
                    .env("NODE_ENV", "production")
                    .env("PORT", "1422")
                    .env("HOSTNAME", "127.0.0.1")
                    .env("AIZEA_DATA_DIR", &data_dir_str)
                    .env("DATABASE_URL", &db_url)
                    // Desktop build ships without docling-serve; tell the
                    // pipeline to skip it and use the pdf-parse fallback.
                    .env("AIZEA_SKIP_DOCLING", "1")
                    .spawn();

                match child {
                    Ok(_) => log::info!("[AIzea] Next.js server started"),
                    Err(e) => log::error!("[AIzea] Failed to start server: {}", e),
                }

                // Give the server a moment to start before the window opens
                std::thread::sleep(std::time::Duration::from_millis(3000));
            }

            // --- Menus -----------------------------------------------
            let file_menu = tauri::menu::SubmenuBuilder::new(app, "Archivo")
                .text("new", "Nuevo")
                .text("quit", "Salir")
                .build()?;

            let help_menu = tauri::menu::SubmenuBuilder::new(app, "Ayuda")
                .text("about", "Acerca de")
                .build()?;

            let menu = tauri::menu::MenuBuilder::new(app)
                .items(&[&file_menu, &help_menu])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                match event.id().as_ref() {
                    "new" => { app.emit("menu-new", ()).ok(); }
                    "quit" => { app.exit(0); }
                    "about" => { app.emit("menu-about", ()).ok(); }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![extract_pdf, save_file, open_file_dialog])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
