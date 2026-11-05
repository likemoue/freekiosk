/**
 * How long the screen stays on with no touch. Android keeps the value itself, so it takes effect at
 * once, without Save, and there is nothing of it in the saved settings.
 */
import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import SettingsRadioGroup from './SettingsRadioGroup';
import SettingsSection from './SettingsSection';
import KioskModule from '../../utils/KioskModule';

const OPTIONS: Array<{ seconds: number; key: string }> = [
  { seconds: 30, key: 's30' },
  { seconds: 60, key: 'm1' },
  { seconds: 120, key: 'm2' },
  { seconds: 300, key: 'm5' },
  { seconds: 600, key: 'm10' },
  { seconds: 1800, key: 'm30' },
  { seconds: -1, key: 'never' },
];

const ScreenTimeoutSection: React.FC = () => {
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
    </SettingsSection>
  );
};

export default ScreenTimeoutSection;
