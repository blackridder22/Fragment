use fragment_core::{CaptureFragmentRequest, FragmentCore};
use serde_json::{json, Value};

pub fn handle_message(core: &FragmentCore, message: Value) -> Value {
    let request_id = message
        .get("requestId")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    match message.get("type").and_then(Value::as_str) {
        Some("ping") => json!({
            "type": "pong",
            "requestId": request_id.unwrap_or_default(),
            "ok": true,
            "app": "Fragment",
            "version": env!("CARGO_PKG_VERSION")
        }),
        Some("frames.list") => match core.list_frames() {
            Ok(frames) => json!({
                "type": "frames.list.result",
                "requestId": request_id.unwrap_or_default(),
                "ok": true,
                "frames": frames
            }),
            Err(error) => error_response(request_id, "frames_list_failed", error.to_string()),
        },
        Some("capture.fragment") => {
            let parsed = serde_json::from_value::<CaptureFragmentRequest>(message);
            match parsed {
                Ok(request) => match core.capture_fragment(request) {
                    Ok(response) => serde_json::to_value(response).unwrap_or_else(|error| {
                        error_response(request_id, "encode_failed", error.to_string())
                    }),
                    Err(error) => {
                        let response = FragmentCore::capture_error_response(
                            request_id.unwrap_or_default(),
                            "capture_failed",
                            error.to_string(),
                        );
                        serde_json::to_value(response).unwrap_or_else(|error| {
                            error_response(None, "encode_failed", error.to_string())
                        })
                    }
                },
                Err(error) => error_response(request_id, "invalid_message", error.to_string()),
            }
        }
        Some(_) => error_response(
            request_id,
            "unknown_message_type",
            "Unknown native message type",
        ),
        None => error_response(
            request_id,
            "invalid_message",
            "Native message is missing type",
        ),
    }
}

fn error_response(
    request_id: Option<String>,
    code: impl Into<String>,
    message: impl Into<String>,
) -> Value {
    json!({
        "type": "error",
        "requestId": request_id,
        "ok": false,
        "error": {
            "code": code.into(),
            "message": message.into()
        }
    })
}
