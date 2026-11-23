//! The interface harness (ADE performance, "Measurement"; roadmap S1.6b). With
//! `LERVO_ADE_MEASURE=<scenario>` and `LERVO_ADE_MEASURE_OUT=<absolute path>`, the page learns its
//! scenario before its first script runs, measures it in this webview, and writes one report.
//! Without both variables nothing is injected and the commands refuse, so a user's app never
//! measures.

use std::path::PathBuf;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, WebviewWindow};

/// A scenario name the page understands, such as `cold-start` or `idle-hidden`.
fn scenario_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
}

/// The measurement this process runs, when the harness started it.
#[derive(Clone)]
pub struct Measurement {
    scenario: String,
    out: PathBuf,
}

impl Measurement {
    /// Reads the harness's variables; any missing or malformed one turns measurement off.
    pub fn from_environment() -> Option<Self> {
        let scenario = std::env::var("LERVO_ADE_MEASURE").ok()?;
        let out = PathBuf::from(std::env::var_os("LERVO_ADE_MEASURE_OUT")?);
        (scenario_name(&scenario) && out.is_absolute()).then_some(Self { scenario, out })
    }
}

/// The plugin that tells the page its scenario, before any page script runs.
pub fn plugin<R: Runtime>(measurement: Option<&Measurement>) -> TauriPlugin<R> {
    let builder = Builder::new("measure");
    match measurement {
        Some(measurement) => builder
            .js_init_script(format!(
                "globalThis.__LERVO_MEASURE__ = {{ scenario: \"{}\" }};",
                measurement.scenario
            ))
            .build(),
        None => builder.build(),
    }
}

/// Writes the page's report, a JSON document of at most 1 MiB, where the harness reads it.
#[tauri::command]
pub fn measure_report(
    state: tauri::State<'_, Option<Measurement>>,
    report: String,
) -> Result<(), String> {
    let measurement = state.inner().as_ref().ok_or("measurement_off")?;
    if report.len() > 1024 * 1024 {
        return Err("measure_report_too_large".to_owned());
    }
    std::fs::write(&measurement.out, report).map_err(|_| "measure_report_unwritten".to_owned())
}

/// Hides the window, for the idle scenario with a hidden window.
#[tauri::command]
pub fn measure_hide(
    state: tauri::State<'_, Option<Measurement>>,
    window: WebviewWindow,
) -> Result<(), String> {
    state.inner().as_ref().ok_or("measurement_off")?;
    window.hide().map_err(|_| "measure_hide_failed".to_owned())
}

#[cfg(test)]
mod tests {
    use super::scenario_name;

    #[test]
    fn accepts_only_plain_scenario_names() {
        assert!(scenario_name("cold-start"));
        assert!(!scenario_name(""));
        assert!(!scenario_name("x\"; alert(1); \""));
        assert!(!scenario_name(&"a".repeat(33)));
    }
}
