# Sreda

<p align="center">
  <img src="docs/banner.png" alt="Sreda — local, private and calm kanban boards" width="100%" />
</p>

Local kanban boards and Markdown documents for Windows and Linux. Boards, documents, themes and the SQLite database stay on your computer. Collaboration uses an invite link. The MCP server for AI tools is off until you turn it on.

The full guide is in Russian: [README.md](README.md). This page is the short English path.

[![CI](https://github.com/ZAREZOV2/sreda/actions/workflows/ci.yml/badge.svg)](https://github.com/ZAREZOV2/sreda/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ZAREZOV2/sreda)](https://github.com/ZAREZOV2/sreda/releases/latest)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Platform: Windows and Linux](https://img.shields.io/badge/platform-Windows%20x64%20%C2%B7%20Linux%20x64-lightgrey)](#install)

## Install

### Windows

Download [Sreda_0.3.0_x64-setup.exe](https://github.com/ZAREZOV2/sreda/releases/download/v0.3.0/Sreda_0.3.0_x64-setup.exe) from the [v0.3.0 release](https://github.com/ZAREZOV2/sreda/releases/tag/v0.3.0). The installer fetches WebView2 if it is missing. Data stays in `%LOCALAPPDATA%\local.sreda.kanban`.

### Linux

Tag builds also publish an AppImage, a `.deb`, an `.rpm`, and a Linux `sreda-mcp` binary from Ubuntu 22.04, so the glibc baseline is old enough for Arch and CachyOS. The AppImage is the straightforward choice there:

```bash
chmod +x Sreda_*_amd64.AppImage
# Arch and CachyOS
sudo pacman -S --needed fuse2 webkit2gtk-4.1 gtk3 librsvg
./Sreda_*_amd64.AppImage
```

Debian and Ubuntu: `sudo apt install ./Sreda_*_amd64.deb` (pulls in `libwebkit2gtk-4.1-0`, GTK 3, `libayatana-appindicator3-1` or `libappindicator3-1`, and `librsvg2-2`). Fedora: `sudo dnf install ./Sreda-*.rpm`.

File dialogs use the desktop portal (`xdg-desktop-portal`), which CachyOS and a normal Arch desktop already provide. Sharing through ngrok uses the same Rust client as Windows. Data lives in `$XDG_DATA_HOME/local.sreda.kanban`, or `~/.local/share/local.sreda.kanban`. The MCP sidecar is installed as `sreda-mcp`, without the Rust target triple. A pull request also uploads these bundles as the `linux-bundles` artifact.

## Build

Node.js 22.16+ and Rust 1.90+.

Windows also needs MSVC, the Visual Studio C++ build tools and WebView2.

```powershell
cd app
npm ci
npm test
npm run typecheck
npm run tauri dev
npm run installer
```

Debian and Ubuntu build dependencies: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev` (or `libappindicator3-dev`), `librsvg2-dev`, `patchelf`, `libssl-dev`, `pkg-config`, `build-essential` and `libdbus-1-dev`. Arch and CachyOS: `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator` or `libappindicator-gtk3`, `librsvg`, `base-devel`, `openssl`, `pkgconf` and `dbus`. Then `npm run bundle:linux` after placing `sreda-mcp` at `src-tauri/binaries/sreda-mcp-<target-triple>`.

## License

[GPL-3.0-or-later](LICENSE). Bundled fonts stay under the SIL Open Font License 1.1. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
