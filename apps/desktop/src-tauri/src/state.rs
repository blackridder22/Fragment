use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use fragment_core::FragmentCore;

pub struct FragmentState {
    pub core: FragmentCore,
    pub cancelled_import_jobs: Arc<Mutex<HashSet<String>>>,
    pub palette_started: AtomicBool,
    pub palette_stopped: Arc<AtomicBool>,
    pub palette_priority: Arc<Mutex<Option<String>>>,
    pub palette_frame: Arc<Mutex<Option<String>>>,
}

impl FragmentState {
    pub fn new() -> Result<Self, fragment_core::CoreError> {
        let started_at = std::time::Instant::now();
        Ok(Self {
            core: FragmentCore::new()?,
            cancelled_import_jobs: Arc::new(Mutex::new(HashSet::new())),
            palette_started: AtomicBool::new(false),
            palette_stopped: Arc::new(AtomicBool::new(false)),
            palette_priority: Arc::new(Mutex::new(None)),
            palette_frame: Arc::new(Mutex::new(None)),
        })
        .inspect(|_| {
            tracing::info!(
                elapsed_ms = started_at.elapsed().as_millis(),
                "initialized Fragment core"
            );
        })
    }
}
