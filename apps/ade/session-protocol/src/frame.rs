//! Frames on the session-host transport (ADE session-host protocol specification, "Frames").
//!
//! A frame is `[length: u32 big-endian][kind: u8][payload]`. Decoding borrows from the read
//! buffer, so terminal bytes reach their consumer without a copy.

/// The largest frame length, counting the kind byte and the payload.
pub const MAX_FRAME_LENGTH: usize = 1024 * 1024;

const LENGTH_BYTES: usize = 4;
const CONTROL_KIND: u8 = 1;
const TERMINAL_KIND: u8 = 2;

/// One decoded frame.
#[derive(Debug, PartialEq, Eq)]
pub enum Frame<'a> {
    /// A MessagePack-encoded control message.
    Control(&'a [u8]),
    /// Raw PTY bytes for a terminal channel.
    Terminal {
        channel: u32,
        sequence: u64,
        bytes: &'a [u8],
    },
}

/// Why a frame could not be encoded or decoded. Each case ends the connection.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum FrameError {
    #[error("frame_too_large: {length} bytes")]
    TooLarge { length: usize },
    #[error("frame_kind_unknown: {kind}")]
    KindUnknown { kind: u8 },
    #[error("frame_empty")]
    Empty,
    #[error("frame_truncated")]
    Truncated,
}

/// Appends a control frame that carries `payload`.
pub fn encode_control(payload: &[u8], output: &mut Vec<u8>) -> Result<(), FrameError> {
    write_frame(CONTROL_KIND, &[payload], output)
}

/// Appends a terminal frame for `channel` at `sequence`.
pub fn encode_terminal(
    channel: u32,
    sequence: u64,
    bytes: &[u8],
    output: &mut Vec<u8>,
) -> Result<(), FrameError> {
    let channel = channel.to_be_bytes();
    let sequence = sequence.to_be_bytes();
    write_frame(TERMINAL_KIND, &[&channel, &sequence, bytes], output)
}

fn write_frame(kind: u8, parts: &[&[u8]], output: &mut Vec<u8>) -> Result<(), FrameError> {
    let length = 1 + parts.iter().map(|part| part.len()).sum::<usize>();
    if length > MAX_FRAME_LENGTH {
        return Err(FrameError::TooLarge { length });
    }
    let length_bytes = u32::try_from(length)
        .map_err(|_| FrameError::TooLarge { length })?
        .to_be_bytes();
    output.reserve(LENGTH_BYTES + length);
    output.extend_from_slice(&length_bytes);
    output.push(kind);
    for part in parts {
        output.extend_from_slice(part);
    }
    Ok(())
}

/// Decodes the first frame in `buffer`.
///
/// Returns `Ok(None)` until the whole frame has arrived, and otherwise the frame together with the
/// number of bytes it occupies.
pub fn decode(buffer: &[u8]) -> Result<Option<(Frame<'_>, usize)>, FrameError> {
    let Some((length_bytes, rest)) = buffer.split_first_chunk::<LENGTH_BYTES>() else {
        return Ok(None);
    };
    let length = usize::try_from(u32::from_be_bytes(*length_bytes))
        .map_err(|_| FrameError::TooLarge { length: usize::MAX })?;
    if length == 0 {
        return Err(FrameError::Empty);
    }
    if length > MAX_FRAME_LENGTH {
        return Err(FrameError::TooLarge { length });
    }
    let Some(frame) = rest.get(..length) else {
        return Ok(None);
    };
    let Some((&kind, payload)) = frame.split_first() else {
        return Err(FrameError::Empty);
    };
    let decoded = match kind {
        CONTROL_KIND => Frame::Control(payload),
        TERMINAL_KIND => {
            let (channel, rest) = payload
                .split_first_chunk::<4>()
                .ok_or(FrameError::Truncated)?;
            let (sequence, bytes) = rest.split_first_chunk::<8>().ok_or(FrameError::Truncated)?;
            Frame::Terminal {
                channel: u32::from_be_bytes(*channel),
                sequence: u64::from_be_bytes(*sequence),
                bytes,
            }
        }
        kind => return Err(FrameError::KindUnknown { kind }),
    };
    Ok(Some((decoded, LENGTH_BYTES + length)))
}

#[cfg(test)]
mod tests {
    use super::{Frame, FrameError, MAX_FRAME_LENGTH, decode, encode_control, encode_terminal};

    #[test]
    fn round_trips_a_control_frame() {
        let mut buffer = Vec::new();
        encode_control(b"payload", &mut buffer).unwrap();
        assert_eq!(
            decode(&buffer).unwrap(),
            Some((Frame::Control(b"payload"), buffer.len()))
        );
    }

    #[test]
    fn round_trips_a_terminal_frame_without_copying() {
        let mut buffer = Vec::new();
        encode_terminal(7, 42, b"\x1b[1mhi", &mut buffer).unwrap();
        let (frame, used) = decode(&buffer).unwrap().unwrap();
        assert_eq!(used, buffer.len());
        let Frame::Terminal {
            channel,
            sequence,
            bytes,
        } = frame
        else {
            panic!("expected a terminal frame");
        };
        assert_eq!((channel, sequence, bytes), (7, 42, &b"\x1b[1mhi"[..]));
        assert_eq!(bytes.as_ptr(), buffer[17..].as_ptr());
    }

    #[test]
    fn waits_for_a_partial_frame() {
        let mut buffer = Vec::new();
        encode_control(b"payload", &mut buffer).unwrap();
        for end in 0..buffer.len() {
            assert_eq!(
                decode(&buffer[..end]).unwrap(),
                None,
                "prefix of {end} bytes"
            );
        }
    }

    #[test]
    fn decodes_frames_one_after_another() {
        let mut buffer = Vec::new();
        encode_control(b"first", &mut buffer).unwrap();
        encode_terminal(1, 1, b"second", &mut buffer).unwrap();
        let (first, used) = decode(&buffer).unwrap().unwrap();
        assert_eq!(first, Frame::Control(b"first"));
        let (second, _) = decode(&buffer[used..]).unwrap().unwrap();
        assert!(matches!(
            second,
            Frame::Terminal {
                bytes: b"second",
                ..
            }
        ));
    }

    #[test]
    fn rejects_oversized_frames_both_ways() {
        let payload = vec![0; MAX_FRAME_LENGTH];
        let mut buffer = Vec::new();
        assert_eq!(
            encode_control(&payload, &mut buffer),
            Err(FrameError::TooLarge {
                length: MAX_FRAME_LENGTH + 1
            })
        );
        let header = u32::try_from(MAX_FRAME_LENGTH + 1).unwrap().to_be_bytes();
        assert_eq!(
            decode(&header),
            Err(FrameError::TooLarge {
                length: MAX_FRAME_LENGTH + 1
            })
        );
    }

    #[test]
    fn rejects_unknown_empty_and_truncated_frames() {
        assert_eq!(
            decode(&[0, 0, 0, 1, 9]),
            Err(FrameError::KindUnknown { kind: 9 })
        );
        assert_eq!(decode(&[0, 0, 0, 0]), Err(FrameError::Empty));
        assert_eq!(decode(&[0, 0, 0, 3, 2, 0, 0]), Err(FrameError::Truncated));
    }
}
