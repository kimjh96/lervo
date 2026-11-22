//! Command-line arguments of `lervo-session-host`.

use std::path::PathBuf;

/// What the command line asks for.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Version,
    Serve { state_dir: Option<PathBuf> },
    Usage,
}

pub fn parse(arguments: &[String]) -> Command {
    match arguments {
        [flag] if flag == "--version" => Command::Version,
        [serve] if serve == "serve" => Command::Serve { state_dir: None },
        [serve, flag, path] if serve == "serve" && flag == "--state-dir" => Command::Serve {
            state_dir: Some(PathBuf::from(path)),
        },
        _ => Command::Usage,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{Command, parse};

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn reads_each_command() {
        assert_eq!(parse(&arguments(&["--version"])), Command::Version);
        assert_eq!(
            parse(&arguments(&["serve"])),
            Command::Serve { state_dir: None }
        );
        assert_eq!(
            parse(&arguments(&["serve", "--state-dir", "/tmp/host"])),
            Command::Serve {
                state_dir: Some(PathBuf::from("/tmp/host"))
            }
        );
    }

    #[test]
    fn rejects_anything_else() {
        for values in [
            &[][..],
            &["serve", "--state-dir"],
            &["--version", "extra"],
            &["run"],
        ] {
            assert_eq!(parse(&arguments(values)), Command::Usage, "{values:?}");
        }
    }
}
