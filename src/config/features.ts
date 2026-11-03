// Feature flags — flip to true to enable in-progress features before public release.
// Change CLOUD_ENABLED to true when ready to ship the cloud management feature.
export const CLOUD_ENABLED = true;

// The management server this build enrolls with unless told otherwise (self-hosted, see cloud/README.md).
// MainActivity.kt holds the same address for `adb ... --es cloud_token`.
export const DEFAULT_CLOUD_URL = 'https://kiosk.ism.io.vn';
