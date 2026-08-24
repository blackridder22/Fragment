use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const HOST_NAME: &str = "com.autoscale.fragment";
pub const EXTENSION_ID: &str = "hnjlkpheocliihhbnnbkoppchffiegij";
const MANIFEST_FILE_NAME: &str = "com.autoscale.fragment.json";
const NATIVE_PROTOCOL_VERSION: u64 = 2;
const MINIMUM_NATIVE_PROTOCOL_VERSION: u64 = 1;
const MAX_MESSAGE_BYTES: u32 = 1024 * 1024;
const PROBE_REQUEST_ID: &str = "fragment-desktop-native-host-status";
#[cfg(not(test))]
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(test)]
const PROBE_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostStatus {
    pub ready: bool,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct NativeHostManifest {
    name: String,
    description: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
    allowed_origins: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHostPing<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    request_id: &'a str,
    protocol_version: u64,
    minimum_protocol_version: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeHostPong {
    #[serde(rename = "type")]
    kind: String,
    request_id: String,
    ok: bool,
    app: String,
    version: String,
    protocol_version: u64,
    minimum_protocol_version: u64,
    compatible: bool,
}

#[derive(Debug, Error)]
enum NativeHostProbeError {
    #[error("could not launch the bundled native host: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("could not exchange a native message with the bundled host: {0}")]
    Io(#[source] std::io::Error),
    #[error("the native host returned an oversized message")]
    MessageTooLarge,
    #[error("the native host returned a corrupt response: {0}")]
    Corrupt(#[source] serde_json::Error),
    #[error("the native host did not respond within three seconds")]
    TimedOut,
    #[error("the native host returned an invalid handshake: {0}")]
    InvalidHandshake(&'static str),
    #[error("the native host version is incompatible with this app")]
    IncompatibleVersion,
    #[error("the native host protocol is incompatible with this app")]
    IncompatibleProtocol,
}

#[derive(Debug, Error)]
pub enum NativeHostInstallError {
    #[error("HOME is not set")]
    HomeUnavailable,
    #[error("bundled Fragment native host is missing at {0}")]
    MissingHost(PathBuf),
    #[error("bundled Fragment native host is not executable at {0}")]
    HostNotExecutable(PathBuf),
    #[error("could not write the Chrome native-host manifest: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not serialize the Chrome native-host manifest: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn install_bundled_native_host(resource_dir: &Path) -> Result<PathBuf, NativeHostInstallError> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or(NativeHostInstallError::HomeUnavailable)?;
    install_native_host_manifest(&home, &resource_dir.join("fragment-host"))
}

pub fn native_host_status(resource_dir: &Path) -> NativeHostStatus {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return not_ready("HOME is not set, so Chrome integration cannot be verified");
    };
    let expected_host_path = resource_dir.join("fragment-host");
    let expected_host_path = match fs::canonicalize(&expected_host_path) {
        Ok(path) => path,
        Err(_) => return not_ready("The bundled Fragment native host is missing"),
    };
    native_host_status_at(&home, &expected_host_path, probe_native_host)
}

fn install_native_host_manifest(
    home: &Path,
    host_path: &Path,
) -> Result<PathBuf, NativeHostInstallError> {
    let metadata = fs::metadata(host_path)
        .map_err(|_| NativeHostInstallError::MissingHost(host_path.to_path_buf()))?;
    if !metadata.is_file() {
        return Err(NativeHostInstallError::MissingHost(host_path.to_path_buf()));
    }
    if !is_executable(&metadata) {
        return Err(NativeHostInstallError::HostNotExecutable(
            host_path.to_path_buf(),
        ));
    }
    let host_path = fs::canonicalize(host_path)?;
    let manifest_path = chrome_manifest_path(home);
    let parent = manifest_path
        .parent()
        .expect("Chrome manifest path always has a parent");
    fs::create_dir_all(parent)?;

    let manifest = NativeHostManifest {
        name: HOST_NAME.to_string(),
        description: "Fragment native messaging host".to_string(),
        path: host_path.to_string_lossy().into_owned(),
        kind: "stdio".to_string(),
        allowed_origins: vec![canonical_extension_origin()],
    };
    let rendered = serde_json::to_vec_pretty(&manifest)?;
    let temporary_path = parent.join(format!(".{MANIFEST_FILE_NAME}.{}.tmp", std::process::id()));
    let mut temporary = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary_path)?;
    temporary.write_all(&rendered)?;
    temporary.write_all(b"\n")?;
    temporary.sync_all()?;
    if let Err(error) = fs::rename(&temporary_path, &manifest_path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(error.into());
    }
    Ok(manifest_path)
}

fn native_host_status_at<F>(home: &Path, expected_host_path: &Path, probe: F) -> NativeHostStatus
where
    F: FnOnce(&Path) -> Result<(), NativeHostProbeError>,
{
    let manifest_path = chrome_manifest_path(home);
    let bytes = match fs::read(&manifest_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return not_ready("Chrome native-host manifest is not installed");
        }
        Err(error) => {
            return not_ready(format!(
                "Chrome native-host manifest cannot be read: {error}"
            ));
        }
    };
    let manifest: NativeHostManifest = match serde_json::from_slice(&bytes) {
        Ok(manifest) => manifest,
        Err(error) => {
            return not_ready(format!("Chrome native-host manifest is invalid: {error}"));
        }
    };
    let expected_origins = vec![canonical_extension_origin()];
    if manifest.name != HOST_NAME
        || manifest.kind != "stdio"
        || manifest.allowed_origins != expected_origins
    {
        return not_ready("Chrome native-host manifest does not authorize this Fragment extension");
    }
    let host_path = Path::new(&manifest.path);
    if host_path != expected_host_path {
        return not_ready(
            "Chrome is not configured to use the native host bundled with this Fragment app",
        );
    }
    let metadata = match fs::metadata(host_path) {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return not_ready("The bundled Fragment native host is missing"),
    };
    if !is_executable(&metadata) {
        return not_ready("The bundled Fragment native host is not executable");
    }
    if let Err(error) = probe(host_path) {
        return not_ready(format!("Native host handshake failed: {error}"));
    }

    NativeHostStatus {
        ready: true,
        label: "Ready".to_string(),
        description: None,
    }
}

fn probe_native_host(host_path: &Path) -> Result<(), NativeHostProbeError> {
    let mut command = Command::new(host_path);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        command.process_group(0);
    }
    let mut child = command.spawn().map_err(NativeHostProbeError::Spawn)?;

    let result = probe_native_host_process(&mut child);
    terminate_child(child);
    result
}

fn probe_native_host_process(child: &mut Child) -> Result<(), NativeHostProbeError> {
    let mut input = child
        .stdin
        .take()
        .ok_or(NativeHostProbeError::InvalidHandshake(
            "stdin was unavailable",
        ))?;
    let output = child
        .stdout
        .take()
        .ok_or(NativeHostProbeError::InvalidHandshake(
            "stdout was unavailable",
        ))?;
    let ping = NativeHostPing {
        kind: "ping",
        request_id: PROBE_REQUEST_ID,
        protocol_version: NATIVE_PROTOCOL_VERSION,
        minimum_protocol_version: MINIMUM_NATIVE_PROTOCOL_VERSION,
    };
    let payload = serde_json::to_vec(&ping).map_err(NativeHostProbeError::Corrupt)?;
    let length = u32::try_from(payload.len()).map_err(|_| NativeHostProbeError::MessageTooLarge)?;
    if length > MAX_MESSAGE_BYTES {
        return Err(NativeHostProbeError::MessageTooLarge);
    }
    input
        .write_all(&length.to_le_bytes())
        .and_then(|()| input.write_all(&payload))
        .and_then(|()| input.flush())
        .map_err(NativeHostProbeError::Io)?;
    drop(input);

    let (sender, receiver) = mpsc::sync_channel(1);
    let reader = thread::spawn(move || {
        let _ = sender.send(read_probe_response(output));
    });
    let response = match receiver.recv_timeout(PROBE_TIMEOUT) {
        Ok(response) => response,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            // The owning scope kills the isolated process group. Do not join here:
            // a wrong host may leave a descendant holding stdout open.
            drop(reader);
            return Err(NativeHostProbeError::TimedOut);
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = reader.join();
            return Err(NativeHostProbeError::InvalidHandshake(
                "the response reader stopped unexpectedly",
            ));
        }
    };
    let _ = reader.join();
    validate_probe_response(response?)
}

fn read_probe_response(mut output: impl Read) -> Result<NativeHostPong, NativeHostProbeError> {
    let mut length_bytes = [0_u8; 4];
    output
        .read_exact(&mut length_bytes)
        .map_err(NativeHostProbeError::Io)?;
    let length = u32::from_le_bytes(length_bytes);
    if length > MAX_MESSAGE_BYTES {
        return Err(NativeHostProbeError::MessageTooLarge);
    }
    let mut payload = vec![0_u8; length as usize];
    output
        .read_exact(&mut payload)
        .map_err(NativeHostProbeError::Io)?;
    serde_json::from_slice(&payload).map_err(NativeHostProbeError::Corrupt)
}

fn validate_probe_response(response: NativeHostPong) -> Result<(), NativeHostProbeError> {
    if response.kind != "pong"
        || response.request_id != PROBE_REQUEST_ID
        || !response.ok
        || response.app != "Fragment"
    {
        return Err(NativeHostProbeError::InvalidHandshake(
            "the response identity did not match Fragment",
        ));
    }
    if response.version != env!("CARGO_PKG_VERSION") {
        return Err(NativeHostProbeError::IncompatibleVersion);
    }
    if !response.compatible
        || response.protocol_version < MINIMUM_NATIVE_PROTOCOL_VERSION
        || response.minimum_protocol_version > NATIVE_PROTOCOL_VERSION
    {
        return Err(NativeHostProbeError::IncompatibleProtocol);
    }
    Ok(())
}

fn terminate_child(mut child: Child) {
    // Kill the process group before checking the direct child. A malformed host
    // can exit after spawning a descendant that keeps stdout open indefinitely.
    // That descendant still belongs to the isolated group and must be stopped.
    #[cfg(unix)]
    kill_process_group(child.id());

    if child.try_wait().ok().flatten().is_some() {
        return;
    }

    // Reap off-thread so a broken executable can never turn the three-second
    // status timeout into an unbounded wait. `kill` is repeated as a direct-
    // child fallback if process-group termination was unavailable.
    let _ = thread::Builder::new()
        .name("fragment-native-host-reaper".to_string())
        .spawn(move || {
            let _ = child.kill();
            let _ = child.wait();
        });
}

#[cfg(unix)]
fn kill_process_group(group_id: u32) {
    use std::os::raw::c_int;

    unsafe extern "C" {
        #[link_name = "kill"]
        fn system_kill(process_id: c_int, signal: c_int) -> c_int;
    }

    const SIGKILL: c_int = 9;
    let Ok(group_id) = c_int::try_from(group_id) else {
        return;
    };
    // SAFETY: the child is spawned as the leader of a new process group, and
    // the converted positive child id is negated to target only that group.
    let _ = unsafe { system_kill(-group_id, SIGKILL) };
}

fn chrome_manifest_path(home: &Path) -> PathBuf {
    home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts")
        .join(MANIFEST_FILE_NAME)
}

fn canonical_extension_origin() -> String {
    format!("chrome-extension://{EXTENSION_ID}/")
}

fn not_ready(description: impl Into<String>) -> NativeHostStatus {
    NativeHostStatus {
        ready: false,
        label: "Setup required".to_string(),
        description: Some(description.into()),
    }
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn installs_canonical_manifest_and_reports_ready() {
        let temp = tempdir().expect("tempdir");
        let home = temp.path().join("Home Folder");
        let resources = temp.path().join("Fragment.app/Contents/Resources");
        fs::create_dir_all(&resources).expect("resources");
        let host_path = resources.join("fragment-host");
        fs::write(&host_path, b"host").expect("host");
        make_executable(&host_path);

        let manifest_path =
            install_native_host_manifest(&home, &host_path).expect("install manifest");
        assert_eq!(manifest_path, chrome_manifest_path(&home));
        let manifest: NativeHostManifest =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read installed manifest"))
                .expect("parse manifest");
        assert_eq!(manifest.name, HOST_NAME);
        assert_eq!(manifest.kind, "stdio");
        assert_eq!(manifest.allowed_origins, vec![canonical_extension_origin()]);
        assert_eq!(Path::new(&manifest.path), host_path.canonicalize().unwrap());

        let status = native_host_status_at(&home, &host_path.canonicalize().unwrap(), |_| Ok(()));
        assert!(status.ready);
        assert_eq!(status.label, "Ready");
        assert!(status.description.is_none());
    }

    #[test]
    fn status_rejects_a_manifest_for_another_extension() {
        let temp = tempdir().expect("tempdir");
        let home = temp.path();
        let host_path = home.join("fragment-host");
        fs::write(&host_path, b"host").expect("host");
        make_executable(&host_path);
        let manifest_path = chrome_manifest_path(home);
        fs::create_dir_all(manifest_path.parent().unwrap()).expect("manifest directory");
        let manifest = NativeHostManifest {
            name: HOST_NAME.to_string(),
            description: "Fragment native messaging host".to_string(),
            path: host_path.to_string_lossy().into_owned(),
            kind: "stdio".to_string(),
            allowed_origins: vec!["chrome-extension://wrong/".to_string()],
        };
        fs::write(
            manifest_path,
            serde_json::to_vec_pretty(&manifest).expect("serialize"),
        )
        .expect("manifest");

        let status = native_host_status_at(home, &host_path.canonicalize().unwrap(), |_| {
            panic!("invalid manifest must not be probed")
        });
        assert!(!status.ready);
        assert_eq!(status.label, "Setup required");
        assert!(status
            .description
            .as_deref()
            .is_some_and(|description| description.contains("does not authorize")));
    }

    #[test]
    fn status_rejects_a_host_that_fails_the_handshake() {
        let temp = tempdir().expect("tempdir");
        let home = temp.path().join("home");
        let host_path = temp
            .path()
            .join("Fragment.app/Contents/Resources/fragment-host");
        fs::create_dir_all(host_path.parent().expect("host parent")).expect("host parent");
        fs::write(&host_path, b"host").expect("host");
        make_executable(&host_path);
        install_native_host_manifest(&home, &host_path).expect("manifest");
        let canonical_host_path = host_path.canonicalize().expect("canonical host");

        let status = native_host_status_at(&home, &canonical_host_path, |_| {
            Err(NativeHostProbeError::IncompatibleProtocol)
        });

        assert!(!status.ready);
        assert!(status
            .description
            .as_deref()
            .is_some_and(|description| { description.contains("protocol is incompatible") }));
    }

    #[test]
    fn corrupt_framed_probe_response_is_rejected() {
        let payload = b"not-json";
        let mut framed = (payload.len() as u32).to_le_bytes().to_vec();
        framed.extend_from_slice(payload);

        assert!(matches!(
            read_probe_response(std::io::Cursor::new(framed)),
            Err(NativeHostProbeError::Corrupt(_))
        ));
    }

    #[test]
    fn incompatible_host_version_is_rejected() {
        let response = NativeHostPong {
            kind: "pong".to_string(),
            request_id: PROBE_REQUEST_ID.to_string(),
            ok: true,
            app: "Fragment".to_string(),
            version: "0.0.6".to_string(),
            protocol_version: NATIVE_PROTOCOL_VERSION,
            minimum_protocol_version: MINIMUM_NATIVE_PROTOCOL_VERSION,
            compatible: true,
        };

        assert!(matches!(
            validate_probe_response(response),
            Err(NativeHostProbeError::IncompatibleVersion)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn descendant_holding_stdout_cannot_extend_probe_timeout() {
        let temp = tempdir().expect("tempdir");
        let home = temp.path().join("home");
        let host_path = temp.path().join("resources/fragment-host");
        let descendant_marker = temp.path().join("descendant-finished");
        fs::create_dir_all(host_path.parent().expect("host parent")).expect("host parent");
        // The direct child exits while a background descendant retains stdout.
        // A bounded probe must return promptly and terminate that descendant.
        let marker = descendant_marker.to_string_lossy().replace('\'', "'\\''");
        fs::write(
            &host_path,
            format!("#!/bin/sh\n(sleep 2; printf leaked > '{marker}') &\nexit 0\n"),
        )
        .expect("host script");
        make_executable(&host_path);
        install_native_host_manifest(&home, &host_path).expect("manifest");
        let canonical_host_path = host_path.canonicalize().expect("canonical host");

        let started_at = std::time::Instant::now();
        let status = native_host_status_at(&home, &canonical_host_path, probe_native_host);

        assert!(!status.ready);
        assert!(started_at.elapsed() < Duration::from_secs(1));
        assert!(status
            .description
            .as_deref()
            .is_some_and(|description| description.contains("did not respond")));
        thread::sleep(Duration::from_millis(2_100));
        assert!(
            !descendant_marker.exists(),
            "timed-out probe descendant was not terminated"
        );
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("permissions");
    }

    #[cfg(not(unix))]
    fn make_executable(_path: &Path) {}
}
