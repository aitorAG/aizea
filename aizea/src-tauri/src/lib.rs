#[cfg_attr(mobile, tauri::mobile_entry_point)]

mod pdf_parser;

use tauri::Emitter;

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
                    "new" => {
                        app.emit("menu-new", ()).ok();
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    "about" => {
                        app.emit("menu-about", ()).ok();
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![extract_pdf, save_file, open_file_dialog])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
