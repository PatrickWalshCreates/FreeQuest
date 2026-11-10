// The desktop shell. All editor logic lives in TypeScript; Rust only hosts
// the window and the file-system and dialog plugins.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running the FreeQuest editor");
}
