fn main() {
    #[cfg(feature = "desktop")]
    {
        println!("cargo:rerun-if-changed=../dist");
        #[cfg(feature = "custom-protocol")]
        assert!(std::path::Path::new("../dist/index.html").is_file(),
            "Frontend is missing. Run npm run build in app before building the release.");
        tauri_build::build();
    }
}
