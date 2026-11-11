// The desktop shell. Editor logic lives in TypeScript; Rust only hosts the
// window, the file-system and dialog plugins (picked folders are remembered
// across launches), and the one thing a web page can't do: run codesign on
// an exported Mac app.

/// Ad-hoc sign an exported Mac app. Exporting changes the player app's
/// contents, which breaks its signature; macOS refuses to open apps with a
/// broken signature, so the export is signed again (ad-hoc: no developer ID).
#[tauri::command]
fn sign_mac_app(path: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Mac apps can only be signed on a Mac".into());
    }
    if !path.ends_with(".app") {
        return Err(format!("not an app bundle: {path}"));
    }
    let output = std::process::Command::new("/usr/bin/codesign")
        .args(["--force", "--deep", "--sign", "-", &path])
        .output()
        .map_err(|error| format!("could not run codesign: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Folders picked in the dialogs stay readable after a restart (recent projects).
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![sign_mac_app])
        .run(tauri::generate_context!())
        .expect("error while running the FreeQuest editor");
}
