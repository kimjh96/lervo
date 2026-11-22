//! The connection token (session-host protocol, "Handshake").
//!
//! The session host writes a new 256-bit token at each start to an owner-only file. Comparison
//! takes constant time, and the token never appears in `Debug` output.

use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use crate::TransportError;

const TOKEN_BYTES: usize = 32;

/// A connection token: 64 lowercase hexadecimal characters.
#[derive(Clone, PartialEq, Eq)]
pub struct Token(String);

impl Token {
    /// A new random token.
    pub fn generate() -> Result<Self, TransportError> {
        let mut bytes = [0_u8; TOKEN_BYTES];
        getrandom::fill(&mut bytes).map_err(|_| TransportError::TokenUnavailable)?;
        Ok(Self(
            bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
        ))
    }

    /// Parses a token from the text of a token file.
    pub fn parse(text: &str) -> Result<Self, TransportError> {
        let text = text.trim();
        let valid = text.len() == TOKEN_BYTES * 2
            && text
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        if !valid {
            return Err(TransportError::TokenMalformed);
        }
        Ok(Self(text.to_owned()))
    }

    /// The token text, for the `hello` message.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether `candidate` equals this token, compared in constant time.
    pub fn matches(&self, candidate: &str) -> bool {
        let expected = self.0.as_bytes();
        let candidate = candidate.as_bytes();
        if expected.len() != candidate.len() {
            return false;
        }
        expected
            .iter()
            .zip(candidate)
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Token(..)")
    }
}

/// Writes the token to `path` with owner-only permissions, replacing any earlier token.
pub fn write(path: &Path, token: &Token) -> Result<(), TransportError> {
    if let Some(directory) = path.parent() {
        create_private_directory(directory)?;
    }
    let temporary = path.with_extension("tmp");
    {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = options.open(&temporary)?;
        file.write_all(token.as_str().as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&temporary, path)?;
    Ok(())
}

/// Reads the token at `path`.
pub fn read(path: &Path) -> Result<Token, TransportError> {
    Token::parse(&fs::read_to_string(path)?)
}

/// Creates `directory` and restricts it to its owner.
pub fn create_private_directory(directory: &Path) -> Result<(), TransportError> {
    fs::create_dir_all(directory)?;
    #[cfg(unix)]
    fs::set_permissions(
        directory,
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Token;

    #[test]
    fn generates_distinct_well_formed_tokens() {
        let first = Token::generate().unwrap();
        let second = Token::generate().unwrap();
        assert_ne!(first, second);
        assert_eq!(Token::parse(first.as_str()).unwrap(), first);
    }

    #[test]
    fn rejects_malformed_tokens() {
        for text in ["", "abc", &"A".repeat(64), &"g".repeat(64), &"a".repeat(65)] {
            assert!(Token::parse(text).is_err(), "{text}");
        }
    }

    #[test]
    fn matches_only_the_same_token() {
        let token = Token::parse(&"a".repeat(64)).unwrap();
        assert!(token.matches(&"a".repeat(64)));
        assert!(!token.matches(&format!("{}b", "a".repeat(63))));
        assert!(!token.matches("a"));
    }

    #[test]
    fn never_prints_the_token() {
        let token = Token::parse(&"a".repeat(64)).unwrap();
        assert_eq!(format!("{token:?}"), "Token(..)");
    }
}
