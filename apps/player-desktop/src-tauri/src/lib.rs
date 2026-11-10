// The desktop player: a window showing @freequest/player's page. The game
// sits in the app bundle's Resources/game folder; exporting a game copies
// this app and swaps that folder. All game logic is TypeScript.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running the FreeQuest player");
}
