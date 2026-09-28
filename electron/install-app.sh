#!/usr/bin/env bash
#
# Package the Electron shell into /Applications/Pi Web.app.
#
# The .app is a thin wrapper: it contains only the Electron runtime plus
# electron/main.cjs, and it remembers where this checkout lives. The heavy parts
# (node_modules 1.5G, .next 1.3G) stay on disk and are used in place, so the
# bundle stays around 250 MB and rebuilds are instant.
#
# Re-run this after moving the checkout, or set the path at runtime in
# ~/Library/Application Support/Pi Web/pi-web-project.json.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Pi Web"
BUNDLE_ID="com.agegr.pi-web.desktop"
TARGET="/Applications/${APP_NAME}.app"

BUILD_DIR="${PROJECT_DIR}/build"
STAGE="${BUILD_DIR}/electron-stage"
OUT="${BUILD_DIR}/electron-out"
DIST="${OUT}/${APP_NAME}-darwin-$(uname -m)"

ELECTRON_VERSION="$(node -p "require('${PROJECT_DIR}/node_modules/electron/package.json').version")"
ARCH="$(uname -m)"
ZIP_NAME="electron-v${ELECTRON_VERSION}-darwin-${ARCH}.zip"

echo "==> Pi Web desktop shell"
echo "    project : ${PROJECT_DIR}"
echo "    electron: ${ELECTRON_VERSION} (darwin-${ARCH})"

# ---------------------------------------------------------------- icon
mkdir -p "${BUILD_DIR}"
if [ ! -f "${BUILD_DIR}/icon.icns" ]; then
  echo "==> Building icon.icns from public/icons/icon-512.png"
  ICONSET="$(mktemp -d)/PiWeb.iconset"
  mkdir -p "${ICONSET}"
  MASTER="$(mktemp -d)/icon-1024.png"
  sips -z 1024 1024 "${PROJECT_DIR}/public/icons/icon-512.png" --out "${MASTER}" >/dev/null
  for size in 16 32 64 128 256 512; do
    sips -z "${size}" "${size}" "${MASTER}" --out "${ICONSET}/icon_${size}x${size}.png" >/dev/null
  done
  sips -z 1024 1024 "${MASTER}" --out "${ICONSET}/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "${ICONSET}" -o "${BUILD_DIR}/icon.icns"
fi

# --------------------------------------------------- reuse the cached zip
# @electron/get caches downloads by URL hash; hand packager the zip directly so
# packaging works offline and does not pull 130 MB again.
ZIP_DIR="${BUILD_DIR}/electron-zip-cache"
mkdir -p "${ZIP_DIR}"
if [ ! -e "${ZIP_DIR}/${ZIP_NAME}" ]; then
  CACHED="$(find "${HOME}/Library/Caches/electron" -type f -name "${ZIP_NAME}" 2>/dev/null | head -1 || true)"
  if [ -n "${CACHED}" ]; then
    echo "==> Reusing cached ${ZIP_NAME}"
    # Symlink, not copy: the zip is ~130 MB and already in the Electron cache.
    ln -sfn "${CACHED}" "${ZIP_DIR}/${ZIP_NAME}"
  else
    echo "==> No cached ${ZIP_NAME}; packager will download it"
  fi
fi

# ------------------------------------------------------------- stage
echo "==> Staging app sources"
rm -rf "${STAGE}"
mkdir -p "${STAGE}/electron"
cp "${PROJECT_DIR}/electron/main.cjs" "${STAGE}/electron/main.cjs"
cat > "${STAGE}/package.json" <<JSON
{
  "name": "pi-web-desktop",
  "productName": "${APP_NAME}",
  "version": "$(node -p "require('${PROJECT_DIR}/package.json').version")",
  "description": "Desktop shell for Pi Web",
  "main": "electron/main.cjs"
}
JSON
# Read back by resolveProjectDir() inside the packaged app.
printf '{ "projectDir": %s }\n' "\"${PROJECT_DIR}\"" > "${STAGE}/pi-web-project.json"

# ----------------------------------------------------------- package
echo "==> Running @electron/packager"
rm -rf "${OUT}"
PACKAGER_ARGS=(
  "${STAGE}" "${APP_NAME}"
  --platform=darwin
  --arch="${ARCH}"
  --out="${OUT}"
  --overwrite
  --electron-version="${ELECTRON_VERSION}"
  --app-bundle-id="${BUNDLE_ID}"
  --app-version="$(node -p "require('${PROJECT_DIR}/package.json').version")"
  --app-category-type=public.app-category.developer-tools
  --icon="${BUILD_DIR}/icon.icns"
  --prune=false
)
if [ -e "${ZIP_DIR}/${ZIP_NAME}" ]; then
  PACKAGER_ARGS+=(--electron-zip-dir="${ZIP_DIR}")
fi

npx --yes @electron/packager@latest "${PACKAGER_ARGS[@]}"

if [ ! -d "${DIST}/${APP_NAME}.app" ]; then
  echo "!! Expected bundle not found at ${DIST}/${APP_NAME}.app" >&2
  exit 1
fi

# ------------------------------------------------------------- install
echo "==> Installing into /Applications"
if [ -d "${TARGET}" ]; then
  osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  sleep 1
fi
rm -rf "${TARGET}"
cp -R "${DIST}/${APP_NAME}.app" "${TARGET}"

# Clear any quarantine flag and re-sign ad-hoc, since packager rewrote Info.plist
# and that invalidates the signature shipped with the Electron zip.
xattr -cr "${TARGET}" 2>/dev/null || true
codesign --force --deep --sign - "${TARGET}" >/dev/null 2>&1 || \
  echo "    (ad-hoc codesign failed; the app may still launch)"

echo "==> Done: ${TARGET}"
echo "    Launch with: open -a \"${APP_NAME}\""
