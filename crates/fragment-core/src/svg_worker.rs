//! Private subprocess transport. Worker mode never initializes a Vault or speaks Chrome framing.
use crate::svg::{SvgError, SvgErrorCode, SvgRenderOutput, MAX_SVG_BYTES};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

static WORKER_PATH: OnceLock<PathBuf> = OnceLock::new();
static SVG_SLOT: Mutex<()> = Mutex::new(());
static WAITERS: AtomicUsize = AtomicUsize::new(0);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
const TIMEOUT: Duration = Duration::from_secs(5);

pub fn configure_worker(path: PathBuf) -> Result<(), PathBuf> {
    WORKER_PATH.set(path)
}

pub fn shutdown_worker() {
    SHUTTING_DOWN.store(true, Ordering::Release);
    let deadline = Instant::now() + Duration::from_millis(500);
    while WAITERS.load(Ordering::Acquire) > 0 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
}

fn worker_path() -> Result<PathBuf, SvgError> {
    if let Some(path) = WORKER_PATH.get() {
        return Ok(path.clone());
    }
    let exe = std::env::current_exe().map_err(unavailable)?;
    if exe.file_stem().is_some_and(|s| s == "fragment-host") {
        return Ok(exe);
    }
    let parent = exe
        .parent()
        .ok_or_else(|| unavailable("No executable directory"))?;
    for path in [
        parent.join("fragment-host"),
        parent.join("../Resources/fragment-host"),
        parent.join("../fragment-host"),
    ] {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(unavailable(
        "The bundled SVG worker is missing. Rebuild or reinstall Fragment.",
    ))
}

fn unavailable(error: impl std::fmt::Display) -> SvgError {
    SvgError::new(SvgErrorCode::SvgWorkerUnavailable, error.to_string())
}
fn cancelled() -> SvgError {
    SvgError::new(SvgErrorCode::SvgCancelled, "SVG rendering was cancelled")
}

#[derive(Serialize, Deserialize)]
struct Request {
    input: PathBuf,
    output: PathBuf,
    tiers: Vec<u32>,
}
#[derive(Serialize, Deserialize)]
struct Response {
    result: Result<SvgRenderOutput, SvgError>,
}

pub struct RenderedSvg {
    pub metadata: SvgRenderOutput,
    directory: tempfile::TempDir,
}
impl RenderedSvg {
    pub fn png(&self, edge: u32) -> Result<Vec<u8>, SvgError> {
        fs::read(self.directory.path().join(format!("{edge}.png"))).map_err(unavailable)
    }
}

struct Waiting;
impl Drop for Waiting {
    fn drop(&mut self) {
        WAITERS.fetch_sub(1, Ordering::AcqRel);
    }
}

pub fn render_svg(
    bytes: &[u8],
    tiers: &[u32],
    temp: &Path,
    cancel: &AtomicBool,
) -> Result<RenderedSvg, SvgError> {
    if bytes.len() > MAX_SVG_BYTES {
        return Err(SvgError::too_large());
    }
    if WAITERS.fetch_add(1, Ordering::AcqRel) >= 9 {
        WAITERS.fetch_sub(1, Ordering::AcqRel);
        return Err(SvgError::new(
            SvgErrorCode::SvgBusy,
            "SVG render queue is full. Try again shortly.",
        ));
    }
    let _waiting = Waiting;
    let _slot = loop {
        if cancel.load(Ordering::Acquire) || SHUTTING_DOWN.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        match SVG_SLOT.try_lock() {
            Ok(slot) => break slot,
            Err(std::sync::TryLockError::WouldBlock) => thread::sleep(Duration::from_millis(10)),
            Err(_) => return Err(unavailable("SVG worker lock failed")),
        }
    };
    let directory = tempfile::Builder::new()
        .prefix("svg-")
        .tempdir_in(temp)
        .map_err(unavailable)?;
    let input = directory.path().join("source.svg");
    fs::write(&input, bytes).map_err(unavailable)?;
    let request = Request {
        input,
        output: directory.path().to_path_buf(),
        tiers: tiers.to_vec(),
    };
    let response_path = directory.path().join("response.json");
    let stdout = fs::File::create(&response_path).map_err(unavailable)?;
    let mut child = Command::new(worker_path()?)
        .arg("--render-svg")
        .stdin(Stdio::piped())
        .stdout(stdout)
        .stderr(Stdio::null())
        .spawn()
        .map_err(unavailable)?;
    let exchange = (|| {
        let request = serde_json::to_vec(&request).map_err(unavailable)?;
        child
            .stdin
            .take()
            .ok_or_else(|| unavailable("Worker stdin unavailable"))?
            .write_all(&request)
            .map_err(unavailable)?;
        wait_child(&mut child, TIMEOUT, cancel)?;
        let mut response = Vec::new();
        fs::File::open(response_path)
            .map_err(unavailable)?
            .take(16 * 1024 + 1)
            .read_to_end(&mut response)
            .map_err(unavailable)?;
        if response.len() > 16 * 1024 {
            return Err(unavailable("Oversized SVG worker response"));
        }
        serde_json::from_slice::<Response>(&response)
            .map_err(unavailable)?
            .result
    })();
    // Reap on every path, including a failed pipe write or corrupt response.
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
    Ok(RenderedSvg {
        metadata: exchange?,
        directory,
    })
}

fn wait_child(
    child: &mut std::process::Child,
    timeout: Duration,
    cancel: &AtomicBool,
) -> Result<(), SvgError> {
    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Acquire)
            || SHUTTING_DOWN.load(Ordering::Acquire)
            || started.elapsed() >= timeout
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if cancel.load(Ordering::Acquire) {
                cancelled()
            } else {
                SvgError::new(
                    SvgErrorCode::SvgRenderTimeout,
                    "SVG rendering exceeded five seconds",
                )
            });
        }
        if let Some(status) = child.try_wait().map_err(unavailable)? {
            return if status.success() {
                Ok(())
            } else {
                Err(unavailable("SVG worker exited unexpectedly"))
            };
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub fn run_private_worker() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = Vec::new();
    std::io::stdin()
        .take(16 * 1024 + 1)
        .read_to_end(&mut input)?;
    if input.len() > 16 * 1024 {
        return Err("Oversized private SVG request".into());
    }
    let request: Request = serde_json::from_slice(&input)?;
    let result = (|| {
        let mut bytes = Vec::new();
        fs::File::open(request.input)
            .map_err(unavailable)?
            .take(MAX_SVG_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(unavailable)?;
        crate::svg::render(&bytes, &request.tiers, &request.output)
    })();
    serde_json::to_writer(std::io::stdout().lock(), &Response { result })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn stalled_child_is_killed_and_reaped() {
        let mut child = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let started = Instant::now();
        let result = wait_child(&mut child, TIMEOUT, &AtomicBool::new(false));
        assert_eq!(result.unwrap_err().code, SvgErrorCode::SvgRenderTimeout);
        assert!(started.elapsed() >= TIMEOUT);
        assert!(started.elapsed() < TIMEOUT + Duration::from_millis(500));
        assert!(child.try_wait().unwrap().is_some());
    }
    #[cfg(unix)]
    #[test]
    fn cancellation_reaps_running_child() {
        let mut child = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let result = wait_child(&mut child, TIMEOUT, &AtomicBool::new(true));
        assert_eq!(result.unwrap_err().code, SvgErrorCode::SvgCancelled);
        assert!(child.try_wait().unwrap().is_some());
    }
}
