import i18next from 'i18next';

/**
 * Translate from code outside React (types, storage, services). Imports i18next itself rather
 * than ./index, so a module the i18n setup depends on can use it without an import cycle.
 * Until i18next has started (a unit test, for instance) the English text is returned.
 */
export function tr(key: string, fallback: string, options?: Record<string, unknown>): string {
  if (!i18next.isInitialized) {
    return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => String(options?.[name] ?? ''));
  }
  return i18next.t(key, { defaultValue: fallback, ...options });
}
