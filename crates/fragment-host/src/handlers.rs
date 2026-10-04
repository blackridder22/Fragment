use fragment_core::{CaptureFragmentRequest, FragmentCore};
use serde_json::{json, Value};

pub const NATIVE_PROTOCOL_VERSION: u64 = 2;
pub const MINIMUM_NATIVE_PROTOCOL_VERSION: u64 = 1;

pub fn handle_message(core: &FragmentCore, message: Value) -> Value {
    let request_id = message
        .get("requestId")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    match message.get("type").and_then(Value::as_str) {
        Some("ping") => ping_response(request_id, &message),
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
                        let code = match &error {
                            fragment_core::CoreError::Svg(svg) => serde_json::to_value(&svg.code)
                                .ok()
                                .and_then(|v| v.as_str().map(str::to_string))
                                .unwrap_or_else(|| "invalid_svg".into()),
                            _ => "capture_failed".into(),
                        };
                        let response = FragmentCore::capture_error_response(
                            request_id.unwrap_or_default(),
                            code,
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

fn ping_response(request_id: Option<String>, message: &Value) -> Value {
    let client_protocol_version = message.get("protocolVersion").and_then(Value::as_u64);
    let client_minimum_protocol_version = message
        .get("minimumProtocolVersion")
        .and_then(Value::as_u64)
        .unwrap_or(client_protocol_version.unwrap_or(MINIMUM_NATIVE_PROTOCOL_VERSION));
    let compatible = client_protocol_version.is_none_or(|version| {
        version >= MINIMUM_NATIVE_PROTOCOL_VERSION
            && client_minimum_protocol_version <= NATIVE_PROTOCOL_VERSION
    });

    json!({
        "type": "pong",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "app": "Fragment",
        "version": env!("CARGO_PKG_VERSION"),
        "protocolVersion": NATIVE_PROTOCOL_VERSION,
        "minimumProtocolVersion": MINIMUM_NATIVE_PROTOCOL_VERSION,
        "capabilities": ["svg", "color_palette"],
        "compatible": compatible
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_negotiates_current_protocol() {
        let response = ping_response(
            Some("ping-current".to_string()),
            &json!({
                "type": "ping",
                "protocolVersion": NATIVE_PROTOCOL_VERSION,
                "minimumProtocolVersion": MINIMUM_NATIVE_PROTOCOL_VERSION
            }),
        );

        assert_eq!(response["requestId"], "ping-current");
        assert_eq!(response["protocolVersion"], NATIVE_PROTOCOL_VERSION);
        assert_eq!(
            response["minimumProtocolVersion"],
            MINIMUM_NATIVE_PROTOCOL_VERSION
        );
        assert_eq!(response["compatible"], true);
    }

    #[test]
    fn ping_keeps_previous_protocol_compatible() {
        let response = ping_response(
            Some("ping-legacy".to_string()),
            &json!({ "type": "ping", "protocolVersion": 1 }),
        );

        assert_eq!(response["compatible"], true);
    }

    #[test]
    fn ping_marks_future_incompatible_protocols() {
        let response = ping_response(
            Some("ping-future".to_string()),
            &json!({
                "type": "ping",
                "protocolVersion": NATIVE_PROTOCOL_VERSION + 2,
                "minimumProtocolVersion": NATIVE_PROTOCOL_VERSION + 1
            }),
        );

        assert_eq!(response["compatible"], false);
    }
}
