/**
 * The backup the USB install tool leaves on a tablet.
 *
 *   - applied once: the file is gone afterwards, also when it was refused, or a bad file would
 *     be retried on every launch
 *   - the two log lines are read by the tool (scripts/cai-tablet-usb/Installer.cs)
 *   - never throws: this runs on the way to the kiosk screen
 */
// A module of its own: other test files declare helpers of the same name, and without this
// they would collide in TypeScript's shared script scope.
export {};

const mockExists = jest.fn();
const mockReadFile = jest.fn();
const mockUnlink = jest.fn();
jest.mock('react-native-fs', () => ({
  ExternalDirectoryPath: '/ext/files',
  DownloadDirectoryPath: '/downloads',
  exists: (...args: any[]) => mockExists(...args),
  readFile: (...args: any[]) => mockReadFile(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
}));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { applyProvisioningBackup } = require('../src/utils/BackupService');

const PATH = '/ext/files/provisioning-backup.json';

describe('applyProvisioningBackup', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  const logged = (spy: jest.SpyInstance) => spy.mock.calls.map(args => String(args[0]));

  beforeEach(async () => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockExists.mockReset().mockResolvedValue(true);
    mockReadFile.mockReset();
    mockUnlink.mockReset().mockResolvedValue(undefined);
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing when the tool left no file', async () => {
    mockExists.mockResolvedValue(false);

    await applyProvisioningBackup();

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(logged(log)).toEqual([]);
    expect(logged(warn)).toEqual([]);
  });

  it('applies the settings, says so, and removes the file', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 1, settings: { '@kiosk_display_mode': 'external_app' } }));

    await applyProvisioningBackup();

    expect(await AsyncStorage.getItem('@kiosk_display_mode')).toBe('external_app');
    expect(logged(log)).toContain('[BackupService] Provisioning backup applied');
    expect(mockUnlink).toHaveBeenCalledWith(PATH);
  });

  it('says why a bad file was refused, and still removes it', async () => {
    mockReadFile.mockResolvedValue('{"not":"a backup"}');

    await applyProvisioningBackup();

    expect(logged(warn).join()).toContain('[BackupService] Provisioning backup refused: ');
    expect(mockUnlink).toHaveBeenCalledWith(PATH);
  });

  it('does not throw when the file cannot be read', async () => {
    mockReadFile.mockRejectedValue(new Error('EACCES'));

    await expect(applyProvisioningBackup()).resolves.toBeUndefined();

    expect(logged(warn).join()).toContain('[BackupService] Provisioning backup refused: ');
    expect(mockUnlink).toHaveBeenCalledWith(PATH);
  });
});
