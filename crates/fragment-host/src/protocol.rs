use std::io::{Read, Write};

use serde::Serialize;
use thiserror::Error;

const MAX_MESSAGE_BYTES: u32 = 1024 * 1024;

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("native message was too large")]
    MessageTooLarge,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type ProtocolResult<T> = Result<T, ProtocolError>;

pub fn read_message<R: Read>(reader: &mut R) -> ProtocolResult<Option<serde_json::Value>> {
    let mut length_bytes = [0_u8; 4];
    match reader.read_exact(&mut length_bytes) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.into()),
    }

    let length = u32::from_le_bytes(length_bytes);
    if length > MAX_MESSAGE_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }

    let mut buffer = vec![0_u8; length as usize];
    reader.read_exact(&mut buffer)?;
    Ok(Some(serde_json::from_slice(&buffer)?))
}

pub fn write_message<W: Write, T: Serialize>(writer: &mut W, message: &T) -> ProtocolResult<()> {
    let bytes = serde_json::to_vec(message)?;
    let length = u32::try_from(bytes.len()).map_err(|_| ProtocolError::MessageTooLarge)?;
    if length > MAX_MESSAGE_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }
    writer.write_all(&length.to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn native_message_round_trip_uses_little_endian_length_prefix() {
        let payload = json!({ "type": "ping", "requestId": "abc" });
        let mut buffer = Vec::new();
        write_message(&mut buffer, &payload).expect("write");

        let expected_len = u32::from_le_bytes(buffer[0..4].try_into().expect("prefix"));
        assert_eq!(expected_len as usize, buffer.len() - 4);

        let mut cursor = std::io::Cursor::new(buffer);
        let decoded = read_message(&mut cursor).expect("read").expect("message");
        assert_eq!(decoded, payload);
    }
}
