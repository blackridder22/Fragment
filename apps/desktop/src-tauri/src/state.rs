use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use fragment_core::FragmentCore;

/// Wakes a background worker. The palette worker drains its queue, then sleeps
/// on this until an import, capture, retry or priority change notifies it, with
/// a 30 s fallback poll for work done by other processes (the native host). The
/// derivative worker sleeps on its own instance once nothing is pending and is
/// woken by `retry_failed_derivatives`.
#[derive(Default)]
pub struct PaletteWaker {
    pending: Mutex<bool>,
    changed: Condvar,
}

impl PaletteWaker {
    pub fn notify(&self, reason: &'static str) {
        if let Ok(mut pending) = self.pending.lock() {
            *pending = true;
            tracing::debug!(reason, "background worker wake requested");
        }
        self.changed.notify_all();
    }

    /// Blocks until notified or `timeout` elapses. Returns true when notified.
    pub fn wait(&self, timeout: Duration) -> bool {
        let Ok(mut pending) = self.pending.lock() else {
            return false;
        };
        if !*pending {
            let (guard, _) = match self.changed.wait_timeout(pending, timeout) {
                Ok(result) => result,
                Err(_) => return false,
            };
            pending = guard;
        }
        std::mem::replace(&mut *pending, false)
    }
}

pub struct FragmentState {
    pub core: FragmentCore,
    pub cancelled_import_jobs: Arc<Mutex<HashSet<String>>>,
    pub palette_started: AtomicBool,
    pub derivatives_started: AtomicBool,
    /// Set once on exit; every background worker checks it between batches.
    pub background_stopped: Arc<AtomicBool>,
    pub palette_priority: Arc<Mutex<Option<String>>>,
    pub palette_frame: Arc<Mutex<Option<String>>>,
    pub palette_waker: Arc<PaletteWaker>,
    pub derivatives_waker: Arc<PaletteWaker>,
}

impl FragmentState {
    pub fn new() -> Result<Self, fragment_core::CoreError> {
        let started_at = std::time::Instant::now();
        Ok(Self {
            core: FragmentCore::new()?,
            cancelled_import_jobs: Arc::new(Mutex::new(HashSet::new())),
            palette_started: AtomicBool::new(false),
            derivatives_started: AtomicBool::new(false),
            background_stopped: Arc::new(AtomicBool::new(false)),
            palette_priority: Arc::new(Mutex::new(None)),
            palette_frame: Arc::new(Mutex::new(None)),
            palette_waker: Arc::new(PaletteWaker::default()),
            derivatives_waker: Arc::new(PaletteWaker::default()),
        })
        .inspect(|_| {
            tracing::info!(
                elapsed_ms = started_at.elapsed().as_millis(),
                "initialized Fragment core"
            );
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waker_returns_immediately_when_already_notified_and_times_out_otherwise() {
        let waker = PaletteWaker::default();
        let started = std::time::Instant::now();
        assert!(!waker.wait(Duration::from_millis(30)));
        assert!(started.elapsed() >= Duration::from_millis(30));
        waker.notify("test");
        assert!(waker.wait(Duration::from_secs(5)));
        assert!(
            !waker.wait(Duration::from_millis(1)),
            "notification is consumed"
        );
    }

    #[test]
    fn waker_wakes_a_waiting_thread() {
        let waker = Arc::new(PaletteWaker::default());
        let waiter = Arc::clone(&waker);
        let handle = std::thread::spawn(move || waiter.wait(Duration::from_secs(5)));
        std::thread::sleep(Duration::from_millis(20));
        waker.notify("test");
        assert!(handle.join().expect("join"));
    }
}
