//! Command-line arguments of `lervo-session-host`.

use std::path::PathBuf;

/// What the command line asks for.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Version,
    Serve {
        state_dir: Option<PathBuf>,
        /// The `lervo` executable that runs the resident process; `lervo` on `PATH` by default.
        lervo: Option<String>,
    },
    Usage,
}

pub fn parse(arguments: &[String]) -> Command {
    match arguments {
        [flag] if flag == "--version" => Command::Version,
        [serve, options @ ..] if serve == "serve" => serve_options(options),
        _ => Command::Usage,
    }
}

fn serve_options(options: &[String]) -> Command {
    let (mut state_dir, mut lervo) = (None, None);
    for pair in options.chunks(2) {
        match pair {
            [flag, value] if flag == "--state-dir" && state_dir.is_none() => {
                state_dir = Some(PathBuf::from(value));
            }
            [flag, value] if flag == "--lervo" && lervo.is_none() => lervo = Some(value.clone()),
            _ => return Command::Usage,
        }
    }
    Command::Serve { state_dir, lervo }
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
            Command::Serve {
                state_dir: None,
                lervo: None
            }
        );
        assert_eq!(
            parse(&arguments(&[
                "serve",
                "--lervo",
                "/opt/lervo",
                "--state-dir",
                "/tmp/host"
            ])),
            Command::Serve {
                state_dir: Some(PathBuf::from("/tmp/host")),
                lervo: Some("/opt/lervo".to_owned())
            }
        );
    }

    #[test]
    fn rejects_anything_else() {
        for values in [
            &[][..],
            &["serve", "--state-dir"],
            &["serve", "--lervo", "a", "--lervo", "b"],
            &["--version", "extra"],
            &["run"],
        ] {
            assert_eq!(parse(&arguments(values)), Command::Usage, "{values:?}");
        }
    }
}
