use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use fragment_core::FragmentCore;

pub struct FragmentState {
    pub core: FragmentCore,
    pub cancelled_import_jobs: Arc<Mutex<HashSet<String>>>,
}

impl FragmentState {
    pub fn new() -> Result<Self, fragment_core::CoreError> {
        let started_at = std::time::Instant::now();
        Ok(Self {
            core: FragmentCore::new()?,
            cancelled_import_jobs: Arc::new(Mutex::new(HashSet::new())),
        })
        .inspect(|_| {
            tracing::info!(
                elapsed_ms = started_at.elapsed().as_millis(),
                "initialized Fragment core"
            );
        })
    }
}
