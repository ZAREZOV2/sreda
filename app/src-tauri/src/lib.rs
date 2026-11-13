pub mod collab;
pub mod storage;
pub mod documents;

#[cfg(feature = "desktop")]
mod desktop;
#[cfg(feature = "desktop")]
mod diagnostics;

#[cfg(feature = "desktop")]
pub fn run() {
    desktop::run();
}
