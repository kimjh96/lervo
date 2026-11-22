//! The Lervo session host (ADR-0613).
//!
//! S1.1 provides only the command-line entry point. S1.3 adds sessions, the segment index, and the
//! local transport behind it.

use std::process::ExitCode;

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Version,
    Usage,
}

fn parse(arguments: &[String]) -> Command {
    match arguments {
        [flag] if flag == "--version" => Command::Version,
        _ => Command::Usage,
    }
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match parse(&arguments) {
        Command::Version => {
            println!("lervo-session-host {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Command::Usage => {
            eprintln!("usage: lervo-session-host --version");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Command, parse};

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn reads_the_version_flag() {
        assert_eq!(parse(&arguments(&["--version"])), Command::Version);
    }

    #[test]
    fn rejects_anything_else() {
        assert_eq!(parse(&arguments(&[])), Command::Usage);
        assert_eq!(parse(&arguments(&["--version", "extra"])), Command::Usage);
        assert_eq!(parse(&arguments(&["serve"])), Command::Usage);
    }
}
