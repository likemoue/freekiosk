/**
 * How long the screen stays on with no touch. Android keeps the value itself, so it takes effect at
 * once, without Save. The config reports it as display.screenOffTimeout and takes it from a profile.
 */
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import SettingsInfoBox from './SettingsInfoBox';
import SettingsRadioGroup from './SettingsRadioGroup';
import SettingsSection from './SettingsSection';
import KioskModule from '../../utils/KioskModule';
import { Typography } from '../../theme';

const OPTIONS: Array<{ seconds: number; key: string }> = [
  { seconds: 30, key: 's30' },
  { seconds: 60, key: 'm1' },
  { seconds: 120, key: 'm2' },
  { seconds: 300, key: 'm5' },
  { seconds: 600, key: 'm10' },
  { seconds: 1800, key: 'm30' },
  { seconds: -1, key: 'never' },
];

interface Props {
  keepScreenOn?: boolean;
}

const ScreenTimeoutSection: React.FC<Props> = ({ keepScreenOn }) => {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    KioskModule.getScreenOffTimeout().then(setSeconds).catch(() => {});
  }, []);

  const choose = async (value: string) => {
    try {
      await KioskModule.setScreenOffTimeout(Number(value));
      setSeconds(Number(value));
    } catch (error: any) {
      Alert.alert(t('advanced.screenTimeout.title'), t('advanced.screenTimeout.failed', { error: error?.message ?? String(error) }));
    }
  };

  return (
    <SettingsSection title={t('advanced.screenTimeout.title')} icon="timer-outline">
      <SettingsRadioGroup
        hint={t('advanced.screenTimeout.hint')}
        options={OPTIONS.map((option) => ({ value: String(option.seconds), label: t(`advanced.screenTimeout.${option.key}`) }))}
        value={seconds === null ? '' : String(seconds)}
        onValueChange={choose}
      />
      {/* FLAG_KEEP_SCREEN_ON holds the kiosk's own screen on whatever this says: a timeout set here
          and not seen to work is most often that (HTP - CS1, 11 November) */}
      {keepScreenOn && seconds !== -1 && (
        <SettingsInfoBox variant="warning">
          <Text style={styles.infoText}>{t('advanced.screenTimeout.keepScreenOnNote')}</Text>
        </SettingsInfoBox>
      )}
    </SettingsSection>
  );
};

const styles = StyleSheet.create({
  infoText: {
    ...Typography.body,
    lineHeight: 22,
  },
});

export default ScreenTimeoutSection;
