#!/usr/bin/env bash
# Builds dist/autopilot-bridge-<version>.zip for upload in wp-admin.
set -euo pipefail
cd "$(dirname "$0")/../bridge-plugin"
ver=$(grep -m1 "Version:" autopilot-bridge/autopilot-bridge.php | awk '{print $NF}')
mkdir -p ../dist
rm -f "../dist/autopilot-bridge-$ver.zip"
zip -qr "../dist/autopilot-bridge-$ver.zip" autopilot-bridge -x '*.DS_Store'
echo "dist/autopilot-bridge-$ver.zip"
mkdir -p ../dashboard/public/downloads
cp "../dist/autopilot-bridge-$ver.zip" ../dashboard/public/downloads/autopilot-bridge.zip
echo "dashboard/public/downloads/autopilot-bridge.zip"
