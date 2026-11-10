import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from './Icon';
import { Colors } from '../theme';
import { useTranslation } from 'react-i18next';
import KioskModule from '../utils/KioskModule';
import { getKioskApps, KioskApp } from '../utils/KioskApps';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * From the PIN screen, with no PIN: the apps of the kiosk screen, to pick and clear. Sign-ins,
 * files and settings go, the apps stay (KioskModule.clearAppData, Device Owner and Android 9).
 */
export default function ClearAppDataDialog({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const [apps, setApps] = useState<KioskApp[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setApps(null);
    setChosen([]);
    getKioskApps()
      .then((found) => {
        if (!live) return;
        setApps(found);
        // One app leaves nothing to choose
        if (found.length === 1) setChosen([found[0].packageName]);
      })
      .catch((e) => {
        console.warn('[ClearAppDataDialog] Could not list the kiosk apps:', e);
        if (live) setApps([]);
      });
    return () => {
      live = false;
    };
  }, [visible]);

  const names = (packages: string[]): string =>
    packages.map((name) => apps?.find((app) => app.packageName === name)?.label ?? name).join(', ');

  const toggle = (packageName: string): void => {
    setChosen((prev) => (prev.includes(packageName) ? prev.filter((name) => name !== packageName) : [...prev, packageName]));
  };

  const close = (): void => {
    if (!busy) onClose();
  };

  const clear = async (): Promise<void> => {
    const packages = [...chosen];
    setBusy(true);
    try {
      console.log(`[ClearAppDataDialog] Clearing from the PIN screen: ${packages.join(', ')}`);
      const outcome = await KioskModule.clearAppData(packages);
      console.log(`[ClearAppDataDialog] Cleared: ${outcome.cleared.join(', ') || 'none'}; failed: ${outcome.failed.join(', ') || 'none'}`);
      const lines: string[] = [];
      if (outcome.cleared.length > 0) {
        lines.push(t('components.clearAppDataDialog.cleared', { apps: names(outcome.cleared) }));
      }
      if (outcome.failed.length > 0) {
        lines.push(t('components.clearAppDataDialog.failed', { apps: names(outcome.failed) }));
      }
      if (outcome.missing.length > 0) {
        lines.push(t('components.clearAppDataDialog.missing', { apps: names(outcome.missing) }));
      }
      // "package/permission": what Android would not give back, which the app cannot ask for in Lock Mode
      const lost = [...new Set(outcome.permissionsLost.map((entry) => entry.split('/')[0]))];
      if (lost.length > 0) {
        lines.push(t('components.clearAppDataDialog.permissionsLost', { apps: names(lost) }));
      }
      setBusy(false);
      onClose();
      Alert.alert(
        outcome.failed.length > 0 ? t('components.clearAppDataDialog.errorTitle') : t('components.clearAppDataDialog.doneTitle'),
        lines.join('\n\n'),
      );
    } catch (e) {
      console.warn('[ClearAppDataDialog] clearAppData error:', e);
      setBusy(false);
      Alert.alert(t('components.clearAppDataDialog.errorTitle'), t('components.clearAppDataDialog.genericError'));
    }
  };

  const confirm = (): void => {
    if (chosen.length === 0 || busy) return;
    Alert.alert(
      t('components.clearAppDataDialog.confirmTitle'),
      t('components.clearAppDataDialog.confirmMessage', { apps: names(chosen) }),
      [
        { text: t('components.clearAppDataDialog.cancel'), style: 'cancel' },
        { text: t('components.clearAppDataDialog.confirm'), style: 'destructive', onPress: () => { clear(); } },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.card} activeOpacity={1}>
          <Text style={styles.title}>{t('components.clearAppDataDialog.title')}</Text>
          <Text style={styles.hint}>{t('components.clearAppDataDialog.hint')}</Text>

          {apps === null ? (
            <ActivityIndicator color={Colors.primary} style={styles.loading} />
          ) : apps.length === 0 ? (
            <Text style={styles.empty}>{t('components.clearAppDataDialog.noApps')}</Text>
          ) : (
            <ScrollView style={styles.list}>
              {apps.map((app) => {
                const isChosen = chosen.includes(app.packageName);
                return (
                  <TouchableOpacity
                    key={app.packageName}
                    style={[styles.row, isChosen && styles.rowChosen]}
                    onPress={() => toggle(app.packageName)}
                    disabled={busy}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isChosen, disabled: busy }}
                  >
                    {app.icon ? (
                      <Image source={{ uri: app.icon }} style={styles.appIcon} />
                    ) : (
                      <View style={[styles.appIcon, styles.initials]}>
                        <Text style={styles.initialsText}>{app.label.substring(0, 2).toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={styles.rowLabel} numberOfLines={2}>{app.label}</Text>
                    <Icon
                      name={isChosen ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={24}
                      color={isChosen ? Colors.error : Colors.textSecondary}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={close} disabled={busy}>
              <Text style={styles.cancelLabel}>{t('components.clearAppDataDialog.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.clearButton, (chosen.length === 0 || busy) && styles.buttonDisabled]}
              onPress={confirm}
              disabled={chosen.length === 0 || busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Icon name="delete-sweep" size={20} color="#fff" style={styles.clearIcon} />
                  <Text style={styles.clearLabel}>{t('components.clearAppDataDialog.clear')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    elevation: 8,
  },
  title: {
    color: '#222',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  hint: {
    color: '#555',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  loading: {
    marginVertical: 24,
  },
  empty: {
    color: '#666',
    fontSize: 14,
    paddingVertical: 16,
    textAlign: 'center',
  },
  list: {
    maxHeight: 360,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f5',
    backgroundColor: '#f8faff',
  },
  rowChosen: {
    borderColor: '#dc3545',
    backgroundColor: '#fdecee',
  },
  appIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 12,
  },
  initials: {
    backgroundColor: '#dfe7f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: '#1b2a4d',
    fontSize: 15,
    fontWeight: '700',
  },
  rowLabel: {
    flex: 1,
    color: '#333',
    fontSize: 15,
    fontWeight: '600',
    marginRight: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 10,
  },
  button: {
    minHeight: 46,
    minWidth: 110,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#cfd6e4',
    backgroundColor: '#fff',
  },
  cancelLabel: {
    color: '#444',
    fontSize: 15,
    fontWeight: '600',
  },
  clearButton: {
    backgroundColor: '#dc3545',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  clearIcon: {
    marginRight: 6,
  },
  clearLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
