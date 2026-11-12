pub mod collab;
pub mod storage;

#[cfg(feature = "desktop")]
mod desktop;

#[cfg(feature = "desktop")]
pub fn run() {
    desktop::run();
}
