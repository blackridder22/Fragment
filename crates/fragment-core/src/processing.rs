//! Process-wide foreground admission shared by single imports and concurrent batch calls.
use std::sync::{Condvar, Mutex, MutexGuard};
static ACTIVE: Mutex<usize> = Mutex::new(0);
static AVAILABLE: Condvar = Condvar::new();
pub(crate) struct Permit;
fn active() -> MutexGuard<'static, usize> {
    ACTIVE.lock().unwrap_or_else(|poison| poison.into_inner())
}
pub(crate) fn acquire() -> Permit {
    let mut count = active();
    while *count >= 2 {
        count = AVAILABLE
            .wait(count)
            .unwrap_or_else(|poison| poison.into_inner());
    }
    *count += 1;
    Permit
}
pub(crate) fn foreground_busy() -> bool {
    *active() > 0
}
impl Drop for Permit {
    fn drop(&mut self) {
        *active() -= 1;
        AVAILABLE.notify_one();
    }
}
