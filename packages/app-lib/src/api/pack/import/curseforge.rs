use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{
    State,
    install::{InstallPhaseDetails, InstallProgressReporter},
    prelude::ModLoader,
    state::{AppliedContentSetPatch, EditInstance, InstanceInstallStage},
    util::{fetch::fetch, io},
};

use super::{finish_import, recache_icon};

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftInstance {
    pub name: Option<String>,
    pub base_mod_loader: Option<MinecraftInstanceModLoader>,
    pub profile_image_path: Option<PathBuf>,
    pub installed_modpack: Option<InstalledModpack>,
    pub game_version: String, // Minecraft game version. Non-prioritized, use this if Vanilla
}
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftInstanceModLoader {
    pub name: String,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModpack {
    pub thumbnail_url: Option<String>,
}

// Check if folder has a minecraftinstance.json that parses
pub async fn is_valid_curseforge(instance_folder: PathBuf) -> bool {
    let minecraft_instance = serde_json::from_str::<MinecraftInstance>(
        &io::read_any_encoding_to_string(
            &instance_folder.join("minecraftinstance.json"),
        )
        .await
        .unwrap_or(("".into(), encoding_rs::UTF_8))
        .0,
    );
    minecraft_instance.is_ok()
}

pub async fn import_curseforge(
    curseforge_instance_folder: PathBuf, // instance's folder
    instance_id: &str,
    reporter: InstallProgressReporter,
    details: InstallPhaseDetails,
) -> crate::Result<()> {
    // Load minecraftinstance.json
    let minecraft_instance = serde_json::from_str::<MinecraftInstance>(
        &io::read_any_encoding_to_string(
            &curseforge_instance_folder.join("minecraftinstance.json"),
        )
        .await
        .unwrap_or(("".into(), encoding_rs::UTF_8))
        .0,
    )?;
    let override_title = minecraft_instance.name;
    let backup_name = format!(
        "Curseforge-{}",
        curseforge_instance_folder
            .file_name()
            .map_or("Unknown".to_string(), |a| a.to_string_lossy().to_string())
    );

    let state = State::get().await?;
    // Recache Curseforge Icon if it exists
    let mut icon = None;

    if let Some(icon_path) = minecraft_instance.profile_image_path.clone() {
        icon = recache_icon(icon_path).await?;
    } else if let Some(InstalledModpack {
        thumbnail_url: Some(thumbnail_url),
    }) = minecraft_instance.installed_modpack.clone()
    {
        let icon_bytes = fetch(
            &thumbnail_url,
            None,
            None,
            None,
            &state.fetch_semaphore,
            &state.pool,
        )
        .await?;
        icon =
            Some(crate::api::instance::cache_icon(icon_bytes, &state).await?);
    }

    // base mod loader is always None for vanilla
    if let Some(instance_mod_loader) = minecraft_instance.base_mod_loader {
        let game_version = minecraft_instance.game_version;

        let (mod_loader, loader_version) =
            parse_curseforge_mod_loader(&instance_mod_loader.name)?;

        let loader_version = if mod_loader != ModLoader::Vanilla {
            crate::launcher::get_loader_version_from_profile(
                &game_version,
                mod_loader,
                loader_version.as_deref(),
            )
            .await?
        } else {
            None
        };

        crate::api::instance::edit(
            instance_id,
            EditInstance {
                install_stage: Some(InstanceInstallStage::PackInstalling),
                name: Some(
                    override_title
                        .clone()
                        .unwrap_or_else(|| backup_name.to_string()),
                ),
                icon_path: Some(
                    icon.clone().map(|x| x.to_string_lossy().to_string()),
                ),
                content_set_patch: Some(AppliedContentSetPatch {
                    source_kind: None,
                    game_version: Some(game_version.clone()),
                    protocol_version: Some(None),
                    loader: Some(mod_loader),
                    loader_version: Some(loader_version.clone().map(|x| x.id)),
                }),
                ..EditInstance::default()
            },
        )
        .await?;
    } else {
        crate::api::instance::edit(
            instance_id,
            EditInstance {
                name: Some(
                    override_title
                        .clone()
                        .unwrap_or_else(|| backup_name.to_string()),
                ),
                icon_path: Some(
                    icon.clone().map(|x| x.to_string_lossy().to_string()),
                ),
                content_set_patch: Some(AppliedContentSetPatch {
                    source_kind: None,
                    game_version: Some(minecraft_instance.game_version.clone()),
                    protocol_version: Some(None),
                    loader: Some(ModLoader::Vanilla),
                    loader_version: Some(None),
                }),
                ..EditInstance::default()
            },
        )
        .await?;
    }

    // Copy in contained folders as overrides
    let state = State::get().await?;
    finish_import(
        instance_id,
        curseforge_instance_folder,
        &state.io_semaphore,
        reporter,
        details,
    )
    .await?;

    Ok(())
}

/// Parse CurseForge `baseModLoader.name` (e.g. `neoforge-21.1.172`, `forge-47.2.0`).
fn parse_curseforge_mod_loader(
    name: &str,
) -> crate::Result<(ModLoader, Option<String>)> {
    let lower = name.trim().to_ascii_lowercase();
    let parts: Vec<&str> = lower.split('-').collect();
    match parts.as_slice() {
        ["forge", version] if !version.is_empty() => {
            Ok((ModLoader::Forge, Some((*version).to_string())))
        }
        ["neoforge", version] if !version.is_empty() => {
            Ok((ModLoader::NeoForge, Some((*version).to_string())))
        }
        ["fabric", version, _game_version] if !version.is_empty() => {
            Ok((ModLoader::Fabric, Some((*version).to_string())))
        }
        ["fabric", version] if !version.is_empty() => {
            Ok((ModLoader::Fabric, Some((*version).to_string())))
        }
        ["quilt", version, ..] if !version.is_empty() => {
            Ok((ModLoader::Quilt, Some((*version).to_string())))
        }
        ["vanilla"] | [] => Ok((ModLoader::Vanilla, None)),
        _ => Err(crate::state::content_store::input(format!(
            "Unsupported CurseForge mod loader '{name}'. Expected forge-*, neoforge-*, fabric-*, quilt-*, or vanilla."
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_neoforge_loader_name() {
        let (loader, version) =
            parse_curseforge_mod_loader("neoforge-21.1.172").unwrap();
        assert_eq!(loader, ModLoader::NeoForge);
        assert_eq!(version.as_deref(), Some("21.1.172"));
    }

    #[test]
    fn parses_forge_and_fabric() {
        let (loader, version) =
            parse_curseforge_mod_loader("forge-47.2.0").unwrap();
        assert_eq!(loader, ModLoader::Forge);
        assert_eq!(version.as_deref(), Some("47.2.0"));

        let (loader, version) =
            parse_curseforge_mod_loader("fabric-0.16.0-1.21.1").unwrap();
        assert_eq!(loader, ModLoader::Fabric);
        assert_eq!(version.as_deref(), Some("0.16.0"));
    }

    #[test]
    fn unknown_loader_is_error_not_silent_vanilla() {
        let err = parse_curseforge_mod_loader("rift-1.0").unwrap_err();
        let message = err.to_string();
        assert!(
            message.contains("Unsupported CurseForge mod loader"),
            "{message}"
        );
    }
}
