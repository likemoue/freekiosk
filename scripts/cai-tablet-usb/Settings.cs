using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace CaiTablet
{
    /// <summary>
    /// What the operator enters once. Kept under the Windows profile rather than next to the
    /// tool, and encrypted for this Windows account, so zipping the tool's folder to hand it
    /// to someone else cannot carry the enrollment code, the PIN or the Wi-Fi password along.
    /// </summary>
    sealed class Settings
    {
        public string ServerUrl = "https://mdm.ism.io.vn";
        public string Token = "";
        public string Pin = "";
        public string WifiName = "";
        public string WifiPassword = "";
        public string BackupPath = ""; // A file from Cài đặt, Nâng cao, Sao lưu và khôi phục
        public string TokenNote = ""; // What a code made from the tool applies, for the window's header
        public bool TurnOffUsbDebugging = true;

        public bool IsComplete
        {
            get { return ServerUrl != "" && Token != "" && Pin != ""; }
        }

        public Settings Copy()
        {
            return (Settings)MemberwiseClone();
        }

        public static string DataFolder
        {
            get
            {
                string forced = Environment.GetEnvironmentVariable("CAITABLET_DATA");
                if (!string.IsNullOrEmpty(forced)) return forced;
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FreeKioskCaiTablet");
            }
        }

        static string FilePath
        {
            get { return Path.Combine(DataFolder, "caidat.txt"); }
        }

        public static Settings Load()
        {
            var settings = new Settings();
            if (!File.Exists(FilePath)) return settings;

            var values = new Dictionary<string, string>();
            foreach (string line in File.ReadAllLines(FilePath, Encoding.UTF8))
            {
                int split = line.IndexOf('=');
                if (split > 0) values[line.Substring(0, split)] = line.Substring(split + 1);
            }

            string text;
            if (values.TryGetValue("server", out text)) settings.ServerUrl = text;
            if (values.TryGetValue("usb_off", out text)) settings.TurnOffUsbDebugging = text == "1";
            if (values.TryGetValue("backup", out text)) settings.BackupPath = text;
            if (values.TryGetValue("token_note", out text)) settings.TokenNote = text;
            settings.Token = Secret(values, "token");
            settings.Pin = Secret(values, "pin");
            settings.WifiName = Secret(values, "wifi_name");
            settings.WifiPassword = Secret(values, "wifi_password");
            return settings;
        }

        public void Save()
        {
            Directory.CreateDirectory(DataFolder);
            File.WriteAllLines(FilePath, new[]
            {
                "server=" + ServerUrl,
                "usb_off=" + (TurnOffUsbDebugging ? "1" : "0"),
                "backup=" + BackupPath,
                "token_note=" + TokenNote,
                "token=" + Protect(Token),
                "pin=" + Protect(Pin),
                "wifi_name=" + Protect(WifiName),
                "wifi_password=" + Protect(WifiPassword),
            }, new UTF8Encoding(false));
        }

        static string Secret(Dictionary<string, string> values, string key)
        {
            string text;
            return values.TryGetValue(key, out text) ? Unprotect(text) : "";
        }

        static string Protect(string value)
        {
            if (value == "") return "";
            byte[] sealedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(sealedBytes);
        }

        static string Unprotect(string value)
        {
            if (value == "") return "";
            try
            {
                return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(value), null, DataProtectionScope.CurrentUser));
            }
            catch (CryptographicException)
            {
                return ""; // Written by another Windows account: ask again
            }
            catch (FormatException)
            {
                return "";
            }
        }
    }
}
