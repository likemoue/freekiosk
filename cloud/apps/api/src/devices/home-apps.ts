/**
 * The apps on the home screen of a tablet, as the app keeps them (src/types/managedApps.ts in
 * general.managedApps). The list is replaced whole by a push, so a change for many tablets is a
 * different list for each one, worked out from what that tablet has.
 */
import { deepMerge } from '../common/crypto.service';

type Json = Record<string, unknown>;

export interface ManagedApp extends Json {
  packageName: string;
  displayName: string;
  showOnHomeScreen: boolean;
}

export const PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

const obj = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {});

/** The `general` section a tablet is about to have: what it reported, with what is on its way over it */
export function generalOf(device: { reportedConfig: unknown; pendingConfig: unknown }): Json {
  return deepMerge(obj(obj(device.reportedConfig).general), obj(obj(device.pendingConfig).general));
}

export function managedAppsOf(general: Json): ManagedApp[] {
  const list = general.managedApps;
  if (!Array.isArray(list)) return [];
  return list.filter((app): app is ManagedApp => typeof obj(app).packageName === 'string');
}

/** A list only shows on a tablet that opens several apps. One that opens a single app ignores it */
export function isMultiApp(general: Json): boolean {
  return general.displayMode === 'external_app' && obj(general.externalApp).mode === 'multi';
}

/**
 * Adds to and removes from the home screen. An app also kept for another reason (opened at boot,
 * kept alive, accessibility allowed) stays in the list, hidden: those settings are not this
 * action's to lose. Any field this code does not know about stays too.
 */
export function editHomeApps(list: ManagedApp[], add: string[], remove: string[], labelOf: (packageName: string) => string): ManagedApp[] {
  const next: ManagedApp[] = [];
  for (const app of list) {
    if (remove.includes(app.packageName)) {
      if (app.launchOnBoot || app.keepAlive || app.allowAccessibility) next.push({ ...app, showOnHomeScreen: false });
    } else {
      next.push(add.includes(app.packageName) ? { ...app, showOnHomeScreen: true } : app);
    }
  }
  for (const packageName of add) {
    if (!list.some((app) => app.packageName === packageName)) {
      next.push({ packageName, displayName: labelOf(packageName), showOnHomeScreen: true, launchOnBoot: false, keepAlive: false, allowAccessibility: false });
    }
  }
  return next;
}
