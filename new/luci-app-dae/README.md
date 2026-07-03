# luci-app-dae

A LuCI application for managing [dae](https://github.com/daeuniverse/dae) — a high-performance transparent proxy solution based on eBPF.

## Features & Improvements Over Upstream

This package includes several enhancements over the original luci-app-dae:

### Inline CPU/Memory/Thread/Uptime Monitoring
- **Instantaneous CPU usage**: Calculated from `/proc/<pid>/stat` field deltas (utime+stime), divided by `CLK_TCK` and `nproc` for accurate multi-core-aware percentage.
- **RSS and VSZ**: Read directly from `/proc/<pid>/status` (VmRSS/VmSize), displayed in human-readable MB/GB.
- **Thread count**: Extracted from `/proc/<pid>/stat` field 20.
- **Uptime**: Derived from system uptime minus process start time (field 22 in `/proc/<pid>/stat`), displayed in human-friendly format (e.g., `1h 5m`, `3d 12h`).
- Stats are shown inline next to the "Running" status indicator, refreshing every 3 seconds.

### Version-Aware Updates
- The update function detects version strings starting with `unstable-`, `dev-`, `nightly-`, `snapshot-`, or `ci-` and routes them to `/root/sh/updae_from_actions.sh` (GitHub Actions builds).
- Stable releases use `installer.sh install-prerelease`.
- Proper version comparison that treats dev/unstable versions as "older" than their base version.

### GeoIP Source Fix
- Uses **Loyalsoldier** v2ray-rules-dat as the GeoIP/GeoSite source (not runetfreedom), which is more reliably maintained.
- URLs: `https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat` and `geosite.dat`.

### Save-Only Config
- "Save" button writes config to disk without restarting dae.
- "Save & Apply" writes config and restarts dae.
- Config validation runs before any start/restart action.

### Enhanced Log Viewer
- Dark mode support with CSS media queries.
- Log level color coding: info (blue), warn (orange), error (red), debug (purple).
- IP address highlighting.
- Filter input with debounce for quick searching.
- Pause/resume log refresh.
- Clear log and scroll controls.

## Installation

### Option 1: OpenWrt Buildroot

1. Clone this repository into your OpenWrt `package/` directory:
   ```bash
   cd openwrt/package
   git clone https://github.com/your-repo/luci-app-dae.git
   ```

2. Update feeds and select the package:
   ```bash
   ./scripts/feeds update -a
   ./scripts/feeds install -a
   make menuconfig  # Navigate to LuCI → Applications → luci-app-dae
   ```

3. Build:
   ```bash
   make package/luci-app-dae/compile V=s
   ```

### Option 2: Standalone Build (build.sh)

The `build.sh` script creates an installable package without needing the full buildroot. Supports both APK (OpenWrt 25.x+) and IPK (legacy opkg):

```bash
chmod +x build.sh

./build.sh           # auto-detect: APK if apk found, else IPK
./build.sh apk       # force APK (OpenWrt 25.x+)
./build.sh ipk       # force IPK (legacy opkg)
```

The output will be in `output/`. Transfer to your device and install:

```bash
# OpenWrt 25.x+ (APK)
apk add --allow-untrusted luci-app-dae_1.0.0-1_all.apk

# Legacy (opkg)
opkg install luci-app-dae_1.0.0-1_all.ipk
```

## Usage

1. Navigate to **Services → dae** in the LuCI web interface.
2. Configure your dae settings in the **Overview** tab.
3. Use the **Validate** button to check your configuration before starting.
4. Click **Start** to launch dae.
5. Monitor CPU, memory, threads, and uptime inline next to the running status.
6. View real-time logs in the **Log** tab with filtering and level-based coloring.

## Requirements

- OpenWrt 21.02+ with LuCI
- `curl` and `unzip` (for the installer/update functionality)
- `ca-bundle` (for HTTPS certificate validation)
- dae binary (installed separately or via the built-in installer)

## License

AGPL-3.0
