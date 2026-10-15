use notify::event::{AccessKind, AccessMode};
use notify::{
    Config, Event, EventHandler, EventKind, RecommendedWatcher, RecursiveMode,
    Watcher, WatcherKind,
};
use std::path::Path;

// inotify reports Open while the launcher scans a watched directory. Filter
// before the mini debouncer discards EventKind, otherwise reconciliation feeds
// its own reads back into the watcher indefinitely.
pub(super) struct ChangeWatcher(RecommendedWatcher);

fn is_change(event: &Event) -> bool {
    event.need_rescan()
        || !matches!(event.kind, EventKind::Access(_))
        || matches!(
            event.kind,
            EventKind::Access(AccessKind::Close(AccessMode::Write))
        )
}

impl Watcher for ChangeWatcher {
    fn new<F: EventHandler>(
        mut handler: F,
        config: Config,
    ) -> notify::Result<Self> {
        RecommendedWatcher::new(
            move |result: notify::Result<Event>| {
                if result.as_ref().is_ok_and(|event| !is_change(event)) {
                    return;
                }
                handler.handle_event(result);
            },
            config,
        )
        .map(Self)
    }

    fn watch(
        &mut self,
        path: &Path,
        recursive_mode: RecursiveMode,
    ) -> notify::Result<()> {
        self.0.watch(path, recursive_mode)
    }

    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        self.0.unwatch(path)
    }

    fn configure(&mut self, config: Config) -> notify::Result<bool> {
        self.0.configure(config)
    }

    fn kind() -> WatcherKind {
        RecommendedWatcher::kind()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{
        CreateKind, DataChange, ModifyKind, RemoveKind, RenameMode,
    };
    use std::{fs, sync::mpsc, time::Duration};

    #[test]
    fn reads_are_ignored_but_mutations_are_kept() {
        for access in [
            AccessKind::Read,
            AccessKind::Open(AccessMode::Any),
            AccessKind::Close(AccessMode::Read),
        ] {
            assert!(!is_change(&Event::new(EventKind::Access(access))));
        }
        for kind in [
            EventKind::Any,
            EventKind::Access(AccessKind::Close(AccessMode::Write)),
            EventKind::Create(CreateKind::File),
            EventKind::Remove(RemoveKind::File),
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            EventKind::Modify(ModifyKind::Metadata(
                notify::event::MetadataKind::Any,
            )),
        ] {
            assert!(is_change(&Event::new(kind)));
        }
        assert!(is_change(
            &Event::new(EventKind::Access(AccessKind::Read))
                .set_flag(notify::event::Flag::Rescan)
        ));
    }

    #[test]
    fn scanning_watched_files_does_not_trigger_reconciliation() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("mod.jar");
        fs::write(&file, b"initial").unwrap();
        let (raw_tx, raw_rx) = mpsc::channel();
        let mut unfiltered = notify_debouncer_mini::new_debouncer(
            Duration::from_millis(50),
            raw_tx,
        )
        .unwrap();
        unfiltered
            .watcher()
            .watch(directory.path(), RecursiveMode::Recursive)
            .unwrap();
        let (tx, rx) = mpsc::channel();
        let mut debouncer =
            notify_debouncer_mini::new_debouncer_opt::<_, ChangeWatcher>(
                notify_debouncer_mini::Config::default()
                    .with_timeout(Duration::from_millis(50)),
                tx,
            )
            .unwrap();
        debouncer
            .watcher()
            .watch(directory.path(), RecursiveMode::Recursive)
            .unwrap();
        for _ in 0..10 {
            let _ = fs::read_dir(directory.path()).unwrap().count();
            assert_eq!(fs::read(&file).unwrap(), b"initial");
        }
        let raw_events = raw_rx
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        assert!(raw_events.iter().any(|event| event.path == file));
        assert!(matches!(
            rx.recv_timeout(Duration::from_millis(300)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        fs::write(&file, b"modified").unwrap();
        let events = rx.recv_timeout(Duration::from_secs(3)).unwrap().unwrap();
        assert!(events.iter().any(|event| event.path == file));
    }
}
