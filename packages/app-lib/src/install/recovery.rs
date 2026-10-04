use super::events::{InstallProgressReporter, emit_install_job};
use super::model::{
    InstallCleanup, InstallErrorView, InstallInterruptReason,
    InstallJobDisplay, InstallJobEventKind, InstallJobState, InstallJobStatus,
    InstallPhaseDetails, InstallPhaseId, InstallProgress,
    InstallProgressSecondary, InstallRequest, InstallTarget,
};
use super::store;
use crate::event::InstancePayloadType;
use crate::event::emit::emit_instance;
use crate::state::instances::adapters::sqlite::{content_rows, instance_rows};
use crate::state::{
    ContentEntry, ContentSetRemoteRef, ContentSetRemoteRefType,
    ContentSetSyncProvider, ContentSetSyncState, InstanceFile,
    InstanceMetadata, State,
};
use async_walkdir::WalkDir;
use chrono::Utc;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const SHARED_INSTANCE_ROLLBACK_FILE: &str = "rollback.json";
const SHARED_INSTANCE_ROLLBACK_INSTANCE_DIR: &str = "instance";
const SHARED_INSTANCE_ROLLBACK_PRESERVED_DIR: &str = "preserved";

/// Heavy / recreatable paths skipped during update backups.
/// Restore stashes these aside before wiping the instance so worlds/caches
/// are not deleted when they were never copied into the backup.
const BACKUP_OMIT_PATH_PREFIXES: &[&str] = &[
    "logs",
    "crash-reports",
    "screenshots",
    "saves",
    ".fabric",
    ".bobby",
    ".voxy",
    "mods/mcef-cache",
    "mods/mcef-libraries",
];

#[derive(Deserialize, Serialize)]
struct SharedInstanceUpdateRollback {
    files: Vec<InstanceFile>,
    entries: Vec<ContentEntry>,
    #[serde(default)]
    bindings: Vec<crate::state::content_store::InstanceFileStorage>,
}

pub(super) async fn prepare_instance_update_backup(
    job_id: Uuid,
    metadata: &InstanceMetadata,
    state: &State,
    reporter: Option<&InstallProgressReporter>,
) -> crate::Result<PathBuf> {
    let _lease = state.content_store.lease().await;
    let _content_lock =
        state.lock_instance_content(&metadata.instance.id).await;
    let _store_lock = state.content_store.files_lock.lock().await;
    if crate::state::instance_has_running_process(&metadata.instance.id, state)
        .await?
    {
        return Err(crate::state::content_store::input(
            "Stop this instance before backing it up for an update",
        ));
    }
    let owner = job_id.to_string();
    let staging_dir = instance_update_backup_dir(job_id, state);
    if tokio::fs::try_exists(&staging_dir).await? {
        crate::util::io::remove_dir_all(&staging_dir).await?;
    }
    crate::util::io::create_dir_all(&staging_dir).await?;

    let result = async {
		crate::state::instances::commands::reconcile_instance_renames(
			&metadata.instance,
			state,
		)
		.await?;
        let files = content_rows::get_instance_files(
            &metadata.instance.id,
            &state.pool,
        )
        .await?;
        let entries = content_rows::get_content_entries(
            &metadata.applied_content_set.id,
            &state.pool,
        )
        .await?;
        let bindings = crate::state::content_store::instance_storage(
            &state.pool,
            &metadata.instance.id,
        )
        .await?;
		for binding in &bindings {
			let file = files
				.iter()
				.find(|file| file.id == binding.file_id)
				.ok_or_else(|| {
					crate::state::content_store::input(
						"Backup content reference has no file record",
					)
				})?;
			let file_status = state.content_store
				.check_instance_file(&metadata.instance, file, binding).await?;
			let content = state.content_store.file_content(file).await?;
			if file_status != crate::state::content_store::InstanceFileStatus::Healthy
				|| !matches!(content, crate::state::content_store::FileContent::Stored { .. })
			{
				return Err(crate::state::content_store::input(format!(
					"Restore or repair {} before updating this instance; its current content cannot be backed up safely",
					file.relative_path,
				)));
			}
		}
        let skipped = files
            .iter()
            .filter(|file| {
                bindings.iter().any(|binding| binding.file_id == file.id)
            })
            .map(crate::state::content_store::content_file_path)
            .collect::<HashSet<_>>();
        let retained = bindings
            .iter()
            .map(|binding| binding.blob_sha512.clone())
            .collect::<Vec<_>>();
        let snapshot = SharedInstanceUpdateRollback {
            files,
            entries,
            bindings,
        };
        let instance_path = state
            .directories
            .instances_dir()
            .join(&metadata.instance.path);
        copy_directory(
            &instance_path,
            &staging_dir.join(SHARED_INSTANCE_ROLLBACK_INSTANCE_DIR),
            &skipped,
            state,
            reporter,
            true,
        )
        .await?;
        crate::util::io::write(
            staging_dir.join(SHARED_INSTANCE_ROLLBACK_FILE),
            serde_json::to_vec(&snapshot)?,
        )
        .await?;
        state
            .content_store
            .retain("rollback", &owner, &retained)
            .await?;

        Ok::<(), crate::Error>(())
    }
    .await;

    if result.is_err() {
        let _ = crate::util::io::remove_dir_all(&staging_dir).await;
        let _ = state.content_store.release("rollback", &owner).await;
    }
    result?;
    Ok(staging_dir)
}

fn instance_update_backup_dir(job_id: Uuid, state: &State) -> PathBuf {
    state
        .directories
        .install_backups_dir()
        .join(job_id.to_string())
}

async fn recover_unrecorded_instance_update_backup(
    job: &mut store::InstallJobRecord,
    state: &State,
) -> crate::Result<()> {
    if job.state.paths.staging_dir.is_some()
        || !matches!(
            &job.state.request,
            InstallRequest::BulkUpdateContent { .. }
                | InstallRequest::UpdateSharedInstance { .. }
                | InstallRequest::InstallPackToExistingInstance { .. }
        )
    {
        return Ok(());
    }
    let staging_dir = instance_update_backup_dir(job.id, state);
    if !tokio::fs::try_exists(&staging_dir).await? {
        return Ok(());
    }
    let snapshot = match crate::util::io::read(
        staging_dir.join(SHARED_INSTANCE_ROLLBACK_FILE),
    )
    .await
    {
        Ok(bytes) => {
            serde_json::from_slice::<SharedInstanceUpdateRollback>(&bytes).ok()
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if snapshot.is_some() {
        job.state.paths.staging_dir = Some(staging_dir);
    } else {
        crate::util::io::remove_dir_all(&staging_dir).await?;
        state
            .content_store
            .release("rollback", &job.id.to_string())
            .await?;
    }
    Ok(())
}

pub(super) async fn clear_staging_dir(job_state: &InstallJobState) {
    let Some(staging_dir) = &job_state.paths.staging_dir else {
        return;
    };
    if let Err(error) = crate::util::io::remove_dir_all(staging_dir).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(
            path = %staging_dir.display(),
            "Failed to remove install rollback backup: {error}"
        );
        return;
    }
    if let Some(state) = State::get_if_initialized()
        && let Some(owner) =
            staging_dir.file_name().and_then(|name| name.to_str())
        && let Err(error) = state.content_store.release("rollback", owner).await
    {
        tracing::warn!(
            "Could not release rollback content references: {error}"
        );
    }
}

async fn restore_instance_update(
    staging_dir: &Path,
    rollback: &super::model::InstallRollbackState,
    state: &State,
) -> crate::Result<()> {
    let instance_id = &rollback.instance.instance.id;
    let _content_lock = state.lock_instance_content(instance_id).await;
    let _store_lock = state.content_store.files_lock.lock().await;
    let _lease = state.content_store.lease().await;
    if crate::state::instance_has_running_process(instance_id, state).await? {
        return Err(crate::state::content_store::input(
            "Stop this instance before restoring its content",
        ));
    }
    state.content_store.recover(Some(instance_id)).await?;
    let snapshot = serde_json::from_slice::<SharedInstanceUpdateRollback>(
        &crate::util::io::read(staging_dir.join(SHARED_INSTANCE_ROLLBACK_FILE))
            .await?,
    )?;
    let instance_path = state
        .directories
        .instances_dir()
        .join(&rollback.instance.instance.path);
    let backup_path = staging_dir.join(SHARED_INSTANCE_ROLLBACK_INSTANCE_DIR);
    if !tokio::fs::symlink_metadata(&backup_path).await?.is_dir() {
        return Err(crate::state::content_store::input(
            "The instance backup is missing or is not a directory",
        ));
    }
    for binding in &snapshot.bindings {
        if state
            .content_store
            .lookup(Some(&binding.blob_sha512), None)
            .await?
            .is_none()
        {
            return Err(crate::state::content_store::input(
                "Repair the backup's shared content before restoring this instance",
            ));
        }
    }
    let preserved_root =
        staging_dir.join(SHARED_INSTANCE_ROLLBACK_PRESERVED_DIR);
    stash_omitted_instance_paths(&instance_path, &preserved_root, state)
        .await?;
    if tokio::fs::try_exists(&instance_path).await? {
        crate::util::io::remove_dir_all(&instance_path).await?;
    }
    copy_directory(
        &backup_path,
        &instance_path,
        &HashSet::new(),
        state,
        None,
        false,
    )
    .await?;
    restore_omitted_instance_paths(&instance_path, &preserved_root, state)
        .await?;
    content_rows::restore_instance_content_snapshot(
        &rollback.instance.instance.id,
        &snapshot.files,
        &snapshot.entries,
        &state.pool,
    )
    .await?;
    restore_instance_metadata(&rollback.instance, state).await?;
    state
        .content_store
        .restore_instance_files(
            &rollback.instance.instance,
            &snapshot.files,
            &snapshot.bindings,
        )
        .await?;

    Ok(())
}

async fn restore_instance_metadata(
    metadata: &InstanceMetadata,
    state: &State,
) -> crate::Result<()> {
    let content_set_id = metadata.applied_content_set.id.as_str();
    let mut tx = state.pool.begin_with("BEGIN IMMEDIATE").await?;
    instance_rows::update_instance(&metadata.instance, &mut tx).await?;
    content_rows::update_content_set(&metadata.applied_content_set, &mut tx)
        .await?;
    instance_rows::upsert_instance_link(
        &metadata.instance.id,
        &metadata.link,
        &mut tx,
    )
    .await?;
    instance_rows::set_shared_instance_attachment(
        &metadata.instance.id,
        metadata.shared_instance.as_ref(),
        &mut tx,
    )
    .await?;
    instance_rows::replace_instance_groups(
        &metadata.instance.id,
        &metadata.group_ids,
        &mut tx,
    )
    .await?;
    instance_rows::upsert_instance_launch_overrides(
        &metadata.launch_overrides,
        &mut tx,
    )
    .await?;
    content_rows::delete_content_set_remote_ref(
        content_set_id,
        ContentSetRemoteRefType::SharedContentSet,
        &mut tx,
    )
    .await?;
    content_rows::delete_content_set_sync_state(content_set_id, &mut tx)
        .await?;
    if let Some(attachment) = &metadata.shared_instance {
        content_rows::upsert_content_set_remote_ref(
            &ContentSetRemoteRef {
                content_set_id: content_set_id.to_string(),
                ref_type: ContentSetRemoteRefType::SharedContentSet,
                ref_id: attachment.id.clone(),
            },
            &mut tx,
        )
        .await?;
        content_rows::upsert_content_set_sync_state(
            &ContentSetSyncState {
                content_set_id: content_set_id.to_string(),
                provider: ContentSetSyncProvider::SharedInstance,
                applied_update_id: attachment
                    .applied_version
                    .map(|value| value.to_string()),
                latest_available_update_id: attachment
                    .latest_version
                    .map(|value| value.to_string()),
                checked_at: Some(Utc::now()),
                status: attachment.status,
            },
            &mut tx,
        )
        .await?;
    }
    tx.commit().await?;

    Ok(())
}

fn is_backup_omitted_path(relative: &str) -> bool {
    BACKUP_OMIT_PATH_PREFIXES.iter().any(|prefix| {
        relative == *prefix
            || relative
                .strip_prefix(prefix)
                .is_some_and(|suffix| suffix.starts_with('/'))
    })
}

async fn stash_omitted_instance_paths(
    instance_path: &Path,
    preserved_root: &Path,
    state: &State,
) -> crate::Result<()> {
    if !tokio::fs::try_exists(instance_path).await? {
        return Ok(());
    }
    for prefix in BACKUP_OMIT_PATH_PREFIXES {
        let source = instance_path.join(prefix);
        if !tokio::fs::try_exists(&source).await? {
            continue;
        }
        let destination = preserved_root.join(prefix);
        if let Some(parent) = destination.parent() {
            crate::util::io::create_dir_all(parent).await?;
        }
        if tokio::fs::try_exists(&destination).await? {
            crate::util::io::remove_dir_all(&destination).await?;
        }
        // rename keeps worlds/caches off the wiped instance path
        if let Err(error) = tokio::fs::rename(&source, &destination).await {
            // Cross-device fallback: copy then remove.
            tracing::warn!(
                "Could not move omitted backup path {} aside ({error}); copying instead",
                source.display()
            );
            copy_directory(
                &source,
                &destination,
                &HashSet::new(),
                state,
                None,
                false,
            )
            .await?;
            crate::util::io::remove_dir_all(&source).await?;
        }
    }
    Ok(())
}

async fn restore_omitted_instance_paths(
    instance_path: &Path,
    preserved_root: &Path,
    state: &State,
) -> crate::Result<()> {
    if !tokio::fs::try_exists(preserved_root).await? {
        return Ok(());
    }
    for prefix in BACKUP_OMIT_PATH_PREFIXES {
        let source = preserved_root.join(prefix);
        if !tokio::fs::try_exists(&source).await? {
            continue;
        }
        let destination = instance_path.join(prefix);
        if let Some(parent) = destination.parent() {
            crate::util::io::create_dir_all(parent).await?;
        }
        if tokio::fs::try_exists(&destination).await? {
            crate::util::io::remove_dir_all(&destination).await?;
        }
        if let Err(error) = tokio::fs::rename(&source, &destination).await {
            tracing::warn!(
                "Could not restore omitted path {} ({error}); copying instead",
                destination.display()
            );
            copy_directory(
                &source,
                &destination,
                &HashSet::new(),
                state,
                None,
                false,
            )
            .await?;
            let _ = crate::util::io::remove_dir_all(&source).await;
        }
    }
    let _ = crate::util::io::remove_dir_all(preserved_root).await;
    Ok(())
}

async fn measure_backup_totals(
    source: &Path,
    skipped: &HashSet<String>,
) -> crate::Result<(u64, u64)> {
    let mut total_bytes = 0u64;
    let mut total_files = 0u64;
    let mut walker = WalkDir::new(source);
    while let Some(entry) = walker.next().await {
        let entry = entry.map_err(|error| {
            crate::ErrorKind::FSError(format!(
                "Failed to measure instance backup path: {error}"
            ))
        })?;
        let entry_path = entry.path();
        let relative_path = entry_path.strip_prefix(source)?;
        let relative = relative_path
            .components()
            .map(|part| part.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if relative.is_empty()
            || skipped.contains(&relative)
            || is_backup_omitted_path(&relative)
        {
            continue;
        }
        let file_type = entry.file_type().await?;
        if file_type.is_file() || file_type.is_symlink() {
            total_files += 1;
            if file_type.is_file() {
                let meta = tokio::fs::metadata(&entry_path).await.ok();
                total_bytes += meta.map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    Ok((total_bytes, total_files))
}

async fn copy_directory(
    source: &Path,
    target: &Path,
    skipped: &HashSet<String>,
    state: &State,
    reporter: Option<&InstallProgressReporter>,
    omit_heavy_paths: bool,
) -> crate::Result<()> {
    crate::util::io::create_dir_all(target).await?;

    let (total_bytes, total_files) = if reporter.is_some() {
        measure_backup_totals(source, skipped).await?
    } else {
        (0, 0)
    };
    if let Some(reporter) = reporter {
        reporter
            .update(
                InstallPhaseId::PreparingInstance,
                Some(InstallProgress {
                    current: 0,
                    total: total_bytes.max(1),
                    secondary: Some(InstallProgressSecondary {
                        current: 0,
                        total: total_files.max(1),
                    }),
                }),
                InstallPhaseDetails::Empty,
            )
            .await?;
    }

    let mut copied_bytes = 0u64;
    let mut copied_files = 0u64;
    let mut walker = WalkDir::new(source);
    while let Some(entry) = walker.next().await {
        if reporter.is_some()
            && let Ok(control) =
                super::control::CURRENT_INSTALL.try_with(Clone::clone)
        {
            control.checkpoint().await?;
        }
        let entry = entry.map_err(|error| {
            crate::ErrorKind::FSError(format!(
                "Failed to read instance backup path: {error}"
            ))
        })?;
        let entry_path = entry.path();
        let relative_path = entry_path.strip_prefix(source)?;
        let relative = relative_path
            .components()
            .map(|part| part.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if relative.is_empty()
            || skipped.contains(&relative)
            || (omit_heavy_paths && is_backup_omitted_path(&relative))
        {
            continue;
        }
        let target_path = target.join(relative_path);
        let file_type = entry.file_type().await?;
        if file_type.is_dir() {
            crate::util::io::create_dir_all(&target_path).await?;
        } else if file_type.is_file() {
            let size = tokio::fs::metadata(&entry_path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            crate::util::fetch::copy(
                &entry_path,
                &target_path,
                &state.io_semaphore,
            )
            .await?;
            copied_bytes = copied_bytes.saturating_add(size);
            copied_files = copied_files.saturating_add(1);
            if let Some(reporter) = reporter {
                reporter
                    .update(
                        InstallPhaseId::PreparingInstance,
                        Some(InstallProgress {
                            current: copied_bytes.min(total_bytes.max(1)),
                            total: total_bytes.max(1),
                            secondary: Some(InstallProgressSecondary {
                                current: copied_files.min(total_files.max(1)),
                                total: total_files.max(1),
                            }),
                        }),
                        InstallPhaseDetails::Empty,
                    )
                    .await?;
            }
        } else if file_type.is_symlink() {
            copy_symlink(&entry_path, &target_path).await?;
            copied_files = copied_files.saturating_add(1);
            if let Some(reporter) = reporter {
                reporter
                    .update(
                        InstallPhaseId::PreparingInstance,
                        Some(InstallProgress {
                            current: copied_bytes.min(total_bytes.max(1)),
                            total: total_bytes.max(1),
                            secondary: Some(InstallProgressSecondary {
                                current: copied_files.min(total_files.max(1)),
                                total: total_files.max(1),
                            }),
                        }),
                        InstallPhaseDetails::Empty,
                    )
                    .await?;
            }
        }
    }

    Ok(())
}

async fn copy_symlink(source: &Path, target: &Path) -> crate::Result<()> {
    if let Some(parent) = target.parent() {
        crate::util::io::create_dir_all(parent).await?;
    }
    let link_target = tokio::fs::read_link(source).await?;
    let absolute = crate::state::content_store::normalize(
        &source
            .parent()
            .ok_or_else(|| {
                crate::state::content_store::input("Invalid backup symlink")
            })?
            .join(link_target),
    );
    let relative_link = crate::state::content_store::relative_link(
        &absolute,
        target.parent().ok_or_else(|| {
            crate::state::content_store::input("Invalid backup target")
        })?,
    );

    #[cfg(unix)]
    tokio::fs::symlink(relative_link, target).await?;

    #[cfg(windows)]
    {
        let metadata = tokio::fs::metadata(&absolute).await.map_err(|error| {
            crate::ErrorKind::FSError(format!(
                "Failed to read symlink target {} while backing up {}: {error}",
                absolute.display(),
                source.display()
            ))
        })?;
        let symlink_result = if metadata.is_dir() {
            tokio::fs::symlink_dir(&relative_link, target).await
        } else {
            tokio::fs::symlink_file(&relative_link, target).await
        };
        match symlink_result {
            Ok(()) => {}
            Err(error)
                if crate::state::content_store::link_unavailable(&error) =>
            {
                tracing::warn!(
                    target: "theseus::install::recovery",
                    "No symlink privilege while backing up {} (os error {:?}). Copying file/folder instead. Enable Windows Developer Mode to keep symlinks.",
                    source.display(),
                    error.raw_os_error(),
                );
                materialize_resolved_path(&absolute, target, metadata.is_dir())
                    .await
                    .map_err(|copy_error| {
                        crate::ErrorKind::FSError(format!(
                            "Failed to copy {} after symlink privilege error (os error 1314). Enable Windows Developer Mode, or free disk space, then retry. Details: {copy_error}",
                            source.display()
                        ))
                        .as_error()
                    })?;
            }
            Err(error) => {
                return Err(crate::ErrorKind::FSError(format!(
                    "Failed to recreate symlink for {}: {error}",
                    source.display()
                ))
                .into());
            }
        }
    }

    Ok(())
}

/// Copy the resolved symlink target when creating a symlink is not allowed.
#[cfg(windows)]
async fn materialize_resolved_path(
    source: &Path,
    target: &Path,
    is_dir: bool,
) -> crate::Result<()> {
    if is_dir {
        crate::util::io::create_dir_all(target).await?;
        let mut read_dir =
            tokio::fs::read_dir(source).await.map_err(|error| {
                crate::ErrorKind::FSError(format!(
                    "Failed to read {}: {error}",
                    source.display()
                ))
            })?;
        while let Some(entry) =
            read_dir.next_entry().await.map_err(|error| {
                crate::ErrorKind::FSError(format!(
                    "Failed to read {}: {error}",
                    source.display()
                ))
            })?
        {
            let entry_path = entry.path();
            let entry_target = target.join(entry.file_name());
            let file_type = entry.file_type().await.map_err(|error| {
                crate::ErrorKind::FSError(format!(
                    "Failed to inspect {}: {error}",
                    entry_path.display()
                ))
            })?;
            if file_type.is_dir() {
                Box::pin(materialize_resolved_path(
                    &entry_path,
                    &entry_target,
                    true,
                ))
                .await?;
            } else if file_type.is_symlink() {
                // Nested symlinks: prefer materializing their targets too.
                Box::pin(copy_symlink(&entry_path, &entry_target)).await?;
            } else {
                crate::state::content_store::writable_copy(
                    &entry_path,
                    &entry_target,
                )
                .await?;
            }
        }
    } else {
        if let Some(parent) = target.parent() {
            crate::util::io::create_dir_all(parent).await?;
        }
        crate::state::content_store::writable_copy(source, target).await?;
    }
    Ok(())
}

#[cfg(test)]
mod backup_omit_tests {
    use super::*;

    #[test]
    fn omits_heavy_and_recreatable_roots() {
        assert!(is_backup_omitted_path("logs"));
        assert!(is_backup_omitted_path("logs/latest.log"));
        assert!(is_backup_omitted_path("crash-reports/crash.txt"));
        assert!(is_backup_omitted_path("saves/world"));
        assert!(is_backup_omitted_path(".bobby/cache"));
        assert!(is_backup_omitted_path("screenshots/a.png"));
        assert!(!is_backup_omitted_path("mods/example.jar"));
        assert!(!is_backup_omitted_path("config/foo.toml"));
        assert!(!is_backup_omitted_path("kubejs/startup_scripts/a.js"));
    }
}

#[cfg(test)]
mod symlink_tests {
    use super::*;

    #[test]
    fn link_unavailable_detects_privilege_errors() {
        let denied = std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "privilege",
        );
        assert!(crate::state::content_store::link_unavailable(&denied));
        if cfg!(windows) {
            let error = std::io::Error::from_raw_os_error(1314);
            assert!(crate::state::content_store::link_unavailable(&error));
        }
    }

    #[test]
    fn symlink_fallback_error_mentions_developer_mode() {
        let message = format!(
            "Failed to copy {} after symlink privilege error (os error 1314). Enable Windows Developer Mode, or free disk space, then retry. Details: disk full",
            Path::new("mods/example.jar").display()
        );
        assert!(message.contains("Developer Mode"));
        assert!(message.contains("1314"));
    }
}

pub async fn recover_interrupted_jobs(state: &State) -> crate::Result<()> {
    let jobs = store::list_interrupted_candidates(state).await?;

    for job in jobs {
        let job_id = job.id;
        if let Err(error) = recover_interrupted_job(job, state).await {
            tracing::error!(
                "Error recovering interrupted install job {job_id}: {error}"
            );
        }
    }

    Ok(())
}

async fn recover_interrupted_job(
    mut job: store::InstallJobRecord,
    state: &State,
) -> crate::Result<()> {
    recover_unrecorded_instance_update_backup(&mut job, state).await?;
    if job.state.display.is_none() {
        job.state.display = display_from_request(&job.state);
    }

    if let Some(instance_id) = target_instance_id(&job.state.target)
        && instance_rows::get_instance_by_id(instance_id, &state.pool)
            .await?
            .is_none()
    {
        let canceled_phase = job.state.progress.phase;
        job.state.error = Some(InstallErrorView::from_message(
            "canceled",
            canceled_phase,
            "Install canceled because the instance was deleted",
        ));
        job.state.record_event(InstallJobEventKind::JobCanceled {
            phase: canceled_phase,
        });

        if let Some(record) = store::finish_active(
            job.id,
            InstallJobStatus::Canceled,
            &job.state,
            state,
        )
        .await?
        {
            store::dismiss(job.id, state).await?;
            clear_staging_dir(&job.state).await;
            emit_install_job(&record.snapshot()).await?;
        }

        return Ok(());
    }

    let interrupted_phase = job.state.progress.phase;
    job.state.record_event(InstallJobEventKind::Interrupted {
        reason: InstallInterruptReason::AppClosed,
        phase: interrupted_phase,
    });
    job.state.progress.phase = InstallPhaseId::RollingBack;
    job.state.progress.progress = None;
    job.state.progress.details = InstallPhaseDetails::Empty;
    job.state.error = Some(InstallErrorView::from_message(
        "app_closed",
        interrupted_phase,
        "App closed while install was running",
    ));

    job.state
        .record_event(InstallJobEventKind::RollbackStarted {
            cleanup: job.state.cleanup.clone(),
        });
    let cleanup_succeeded = match apply_cleanup(&job.state, state).await {
        Ok(()) => {
            job.state
                .record_event(InstallJobEventKind::RollbackCompleted);
            clear_deleted_new_instance_id(&mut job.state);
            true
        }
        Err(error) => {
            tracing::error!(
                "Error cleaning up interrupted install job {}: {error}",
                job.id
            );
            job.state.rollback_error = Some(InstallErrorView::from_error(
                "rollback_error",
                InstallPhaseId::RollingBack,
                &error,
                None,
            ));
            job.state.record_event(InstallJobEventKind::RollbackFailed {
                message: error.to_string(),
            });
            false
        }
    };

    if let Some(record) = store::finish_active(
        job.id,
        InstallJobStatus::Interrupted,
        &job.state,
        state,
    )
    .await?
    {
        if cleanup_succeeded {
            clear_staging_dir(&job.state).await;
        }
        emit_install_job(&record.snapshot()).await?;
    }

    Ok(())
}

fn target_instance_id(target: &InstallTarget) -> Option<&str> {
    match target {
        InstallTarget::NewInstance { instance_id } => instance_id.as_deref(),
        InstallTarget::ExistingInstance { instance_id } => Some(instance_id),
    }
}

fn clear_deleted_new_instance_id(job_state: &mut InstallJobState) {
    if matches!(job_state.cleanup, InstallCleanup::DeleteNewInstance { .. }) {
        job_state.target = InstallTarget::NewInstance { instance_id: None };
        job_state.cleanup =
            InstallCleanup::DeleteNewInstance { instance_id: None };
    }
}

fn display_from_request(state: &InstallJobState) -> Option<InstallJobDisplay> {
    match &state.request {
        InstallRequest::CreateInstance { name, icon_path, .. } => {
            Some(InstallJobDisplay {
                title: name.clone(),
                icon: icon_path.clone(),
            })
        }
        InstallRequest::CreateModpackInstance { location, .. } => match location {
            crate::api::pack::install_from::CreatePackLocation::FromVersionId {
                title,
                icon_url,
                ..
            } => Some(InstallJobDisplay {
                title: title.clone(),
                icon: icon_url.clone(),
            }),
            crate::api::pack::install_from::CreatePackLocation::FromFile {
                ..
            } => None,
        },
        InstallRequest::CreateSharedInstance { data } => {
            Some(InstallJobDisplay {
                title: data.name.clone(),
                icon: data
                    .modpack
                    .as_ref()
                    .and_then(|modpack| modpack.icon_url.clone()),
            })
        }
        InstallRequest::ImportInstance {
            instance_folder, ..
        } => Some(InstallJobDisplay {
            title: instance_folder.clone(),
            icon: None,
        }),
        InstallRequest::DuplicateInstance { .. }
        | InstallRequest::InstallExistingInstance { .. }
        | InstallRequest::InstallPackToExistingInstance { .. }
		| InstallRequest::BulkUpdateContent { .. }
        | InstallRequest::UpdateSharedInstance { .. } => {
            state.rollback.as_ref().map(|rollback| InstallJobDisplay {
                title: rollback.instance.instance.name.clone(),
                icon: rollback.instance.instance.icon_path.clone(),
            })
        }
    }
}

pub async fn apply_cleanup(
    job_state: &InstallJobState,
    state: &State,
) -> crate::Result<()> {
    match &job_state.cleanup {
        InstallCleanup::DeleteNewInstance { instance_id } => {
            if let Some(instance_id) = instance_id {
                if crate::state::get_instance(instance_id, &state.pool)
                    .await?
                    .is_some()
                {
                    crate::state::remove_instance(instance_id, state).await?;
                }
                if let Err(error) =
                    emit_instance(instance_id, InstancePayloadType::Removed)
                        .await
                {
                    tracing::warn!(
                        "Failed to emit removed instance {instance_id}: {error}"
                    );
                }
            }
        }
        InstallCleanup::RestoreExistingInstance { instance_id } => {
            if let Some(rollback) = &job_state.rollback {
                if let Some(staging_dir) = &job_state.paths.staging_dir {
                    restore_instance_update(staging_dir, rollback, state)
                        .await?;
                } else {
                    crate::state::instances::commands::set_instance_install_stage(
                        instance_id,
                        rollback.install_stage,
                        &state.pool,
                    )
                    .await?;
                }
                if let Err(error) =
                    emit_instance(instance_id, InstancePayloadType::Edited)
                        .await
                {
                    tracing::warn!(
                        "Failed to emit restored instance {instance_id}: {error}"
                    );
                }
            }
        }
    }

    Ok(())
}
