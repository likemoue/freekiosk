import { StorageService } from './storage';
import AppLauncherModule from './AppLauncherModule';

const OWN_PACKAGE = 'com.freekiosk';

export interface KioskApp {
  packageName: string;
  label: string;
  /** From AppLauncherModule.getAppIcon, absent when Android gave none */
  icon?: string;
}

/**
 * The apps the kiosk screen offers: the grid with several apps, the one app otherwise, none
 * in the other display modes. An app on the list but gone from the tablet is left out, as the
 * grid leaves it out.
 */
export async function getKioskApps(): Promise<KioskApp[]> {
  const [displayMode, mode, managed, single] = await Promise.all([
    StorageService.getDisplayMode(),
    StorageService.getExternalAppMode(),
    StorageService.getManagedApps(),
    StorageService.getExternalAppPackage(),
  ]);
  if (displayMode !== 'external_app') return [];

  const listed: Array<{ packageName: string; displayName: string }> =
    mode === 'multi'
      ? managed.filter((app) => app.showOnHomeScreen)
      : single ? [{ packageName: single, displayName: '' }] : [];
  const wanted = listed.filter(
    (app, index) => app.packageName !== OWN_PACKAGE && listed.findIndex((other) => other.packageName === app.packageName) === index,
  );

  const apps = await Promise.all(
    wanted.map(async (app): Promise<KioskApp | null> => {
      // Only a clear no drops an app: an answer that did not come is no reason to
      const installed = await Promise.resolve(AppLauncherModule.isAppInstalled?.(app.packageName)).catch(() => true);
      if (installed === false) return null;
      const label = await Promise.resolve(AppLauncherModule.getPackageLabel(app.packageName)).catch(() => null);
      const icon = await Promise.resolve(AppLauncherModule.getAppIcon(app.packageName, 96)).catch(() => null);
      return {
        packageName: app.packageName,
        label: label || app.displayName || app.packageName,
        ...(icon ? { icon } : {}),
      };
    }),
  );
  return apps.filter((app): app is KioskApp => app !== null);
}
