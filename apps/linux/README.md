# Clawdbot Linux Node (MVP)

This is a Linux node implementation for Clawdbot, targeting **Ubuntu Desktop (X11)**.
It connects to the Clawdbot gateway bridge (TCP newline-delimited JSON), supports pairing,
executes node commands (screen/camera/system), and provides a Canvas UI via an Electron window.

## Prerequisites

- Node.js **22+**
- `pnpm`
- Ubuntu Desktop with **X11** (`$DISPLAY` available)
- Tools:
  - `ffmpeg` (includes `ffprobe`) for `screen.record` / `camera.snap`
  - `notify-send` for `system.notify` (package: `libnotify-bin`)
  - Optional: `v4l2-ctl` (package: `v4l-utils`) for better camera listing
  - Optional: `xrandr` for automatic screen size detection

Install tools:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg libnotify-bin v4l-utils x11-xserver-utils
```

## Build

From the repo root:

```bash
pnpm install
pnpm -C apps/linux build
```

## Run

The gateway (macOS menubar app) must be running with the node bridge enabled.

Run the node and point it at your gateway bridge host/port:

```bash
pnpm -C apps/linux start -- --host <gateway-ip> --port <bridge-port>
```

### Pairing

On first run, the node requests pairing and waits for approval from the gateway UI.
A node token is stored locally at:

- `~/.clawdbot/linux-node/bridge.json`

## Supported Commands (MVP)

- `system.run` (argv, cwd/env/timeout)
- `system.notify` (desktop notifications)
- `screen.record` (X11 recording via `ffmpeg -f x11grab`)
- `camera.list` / `camera.snap` (V4L2 + ffmpeg)
- Canvas UI (Electron BrowserWindow)
  - `canvas.present`, `canvas.hide`, `canvas.navigate`, `canvas.eval`, `canvas.snapshot`
  - `canvas.a2ui.reset`, `canvas.a2ui.push`, `canvas.a2ui.pushJSONL`

## Notes

- This MVP targets X11. Wayland is not supported for `screen.record`.
- `screen.record` captures the root window for `$DISPLAY` (default `:0`).
