mod handlers;
mod protocol;

use std::io::Write;
use std::io::{stdin, stdout};

use anyhow::Context;
use fragment_core::FragmentCore;
use tracing::error;

fn main() -> anyhow::Result<()> {
    // This private mode must run before tracing hooks and, especially, Vault initialization.
    if std::env::args().nth(1).as_deref() == Some("--render-svg") {
        return fragment_core::svg_worker::run_private_worker()
            .map_err(|error| anyhow::anyhow!("{error}"));
    }
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_target(false)
        .init();

    trace_host("start");
    trace_host("core_init_start");
    let core = FragmentCore::new().context("failed to initialize Fragment core")?;
    trace_host("core_init_ok");
    let mut input = stdin().lock();
    let mut output = stdout().lock();

    loop {
        trace_host("read_wait");
        let message = match protocol::read_message(&mut input) {
            Ok(Some(message)) => message,
            Ok(None) => {
                trace_host("stdin_eof");
                break;
            }
            Err(error) => {
                trace_host(&format!("read_error:{error}"));
                return Err(error).context("failed to read native message");
            }
        };
        let message_type = message
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        trace_host(&format!("message:{message_type}"));

        let response = handlers::handle_message(&core, message);
        let response_type = response
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        trace_host(&format!("response:{response_type}:write_start"));
        if let Err(error) = protocol::write_message(&mut output, &response) {
            trace_host(&format!("write_error:{error}"));
            error!(%error, "failed to write native message");
            break;
        }
        trace_host(&format!("response:{response_type}:write_ok"));
    }

    Ok(())
}

fn trace_host(message: &str) {
    let Some(path) = std::env::var_os("FRAGMENT_HOST_TRACE_FILE") else {
        return;
    };

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(
            file,
            "{} pid={} {}",
            chrono::Utc::now().to_rfc3339(),
            std::process::id(),
            message
        );
    }
}
