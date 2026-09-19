# OrbWarden

Discord quest helper — complete video, stream, game, and activity quests automatically.

## Features

- Auto-complete Discord quests (video, stream, play, activity)
- CDP mode for direct Discord integration
- Simulated game mode for Windows/macOS
- Batch quest runner
- Multi-account support
- Orbs reward tracking

## Requirements

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| pnpm | 8+ |
| Rust | latest |
| Tauri CLI | 2.x |

### Linux-specific

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf libssl-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev

# Arch
sudo pacman -S webkit2gtk-4.1 appstream-glib librsvg patchelf openssl gtk3 libsoup3

# Fedora
sudo dnf install -y webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel \
  patchelf openssl-devel gtk3-devel libsoup3-devel
```

## Install

### Linux

```bash
git clone https://github.com/your-repo/orbwarden.git
cd orbwarden
pnpm install
pnpm run tauri:dev
```

To build a release binary:

```bash
pnpm run tauri:build
# Binary: src-tauri/target/release/orbwarden
# Package: src-tauri/target/release/bundle/
```

### Windows

1. Install [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/), and [pnpm](https://pnpm.io/):
   ```powershell
   npm install -g pnpm
   ```
2. Clone and build:
   ```powershell
   git clone https://github.com/your-repo/orbwarden.git
   cd orbwarden
   pnpm install
   pnpm run tauri:build
   ```
3. Or use the setup script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File setup.ps1
   ```
4. Installer is in `src-tauri\target\release\bundle\`.

### Quick Launch

```powershell
# Windows - launch in dev mode
powershell -ExecutionPolicy Bypass -File launch.ps1

# Linux
pnpm run tauri:dev
```

## Usage

1. Launch OrbWarden
2. Log in with your Discord token or via CDP
3. Go to Settings > Discord Integration to launch Discord with CDP
4. Accept quests from the Home tab
5. Click Start to begin quest completion

## License

MIT
