pub mod checklist;
pub mod collab;
pub mod documents;
pub mod markdown_html;
pub mod mcp;
pub mod recurrence;
pub mod search;
pub mod storage;

#[cfg(feature = "desktop")]
mod desktop;
#[cfg(feature = "desktop")]
mod diagnostics;

#[cfg(feature = "desktop")]
pub fn run() {
    desktop::run();
}
