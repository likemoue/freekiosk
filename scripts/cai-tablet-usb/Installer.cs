using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace CaiTablet
{
    enum Step { Connect, Check, Install, Owner, Network, Enroll, Config, Finish }

    enum StepState { Waiting, Running, Done, Skipped, Failed }

    enum Tone { Neutral, Working, Success, Attention, Problem }

    interface IInstallerView
    {
        void ShowStatus(string title, string detail, Tone tone);
        void ResetSteps();
        void SetStep(Step step, StepState state, string note);
        void Log(string line);
        void ShowRetry(bool visible);
        void TabletDone();
    }

    /// <summary>Something the operator has to fix: says what, and what to do about it.</summary>
    sealed class TabletProblem : Exception
    {
        public readonly string Detail;

        public TabletProblem(string title, string detail)
            : base(title)
        {
            Detail = detail;
        }
    }

    sealed class TabletGone : Exception
    {
    }

    /// <summary>
    /// Watches for tablets and takes each one from USB debugging to enrolled. Every step checks
    /// what is already there, so a tablet that was unplugged halfway can simply be plugged back in.
    /// </summary>
    sealed class Installer
    {
        const string Package = "com.freekiosk";
        const string AdminComponent = "com.freekiosk/.DeviceAdminReceiver";

        // The lines src/utils/CloudSyncService.ts and KioskScreen.tsx print: keep them in step
        const string LogAccepted = "[CloudSync] Queued enrollment accepted";
        const string LogDiscarded = "[CloudSync] Queued enrollment discarded";
        const string LogRefused = "[CloudSync] Queued enrollment refused: ";
        const string LogUnreachable = "[CloudSync] Queued enrollment could not reach the server";
        const string LogPinSaved = "PIN saved to secure Keystore";
        const string LogPinFailed = "PIN could NOT be saved";
        const string LogPinRejected = "Rejected: Invalid PIN";
        const string LogBackupApplied = "[BackupService] Provisioning backup applied";
        const string LogBackupRefused = "[BackupService] Provisioning backup refused: ";

        const int EnrollTimeoutSeconds = 120;
        const int PinTimeoutSeconds = 45;
        const int WifiEnableSeconds = 15;
        const int WifiTimeoutSeconds = 40;
        const int NetworkWaitSeconds = 600;
        const int ClockTimeoutSeconds = 90;
        const int NoTabletHintSeconds = 30;
        const int MinimumTls13Sdk = 29; // Android 10: below it there is no TLS 1.3, which the website's Cloudflare zone requires

        readonly Adb adb;
        readonly string apkPath;
        readonly IInstallerView view;
        readonly CancellationToken stop;
        volatile Settings settings;
        volatile bool retryRequested;

        // Per tablet being handled
        string serial;
        string model = "";
        int sdk;
        string ownerPackage;
        Step currentStep;

        public Installer(Adb adb, string apkPath, Settings settings, IInstallerView view, CancellationToken stop)
        {
            this.adb = adb;
            this.apkPath = apkPath;
            this.settings = settings;
            this.view = view;
            this.stop = stop;
        }

        public void UseSettings(Settings updated)
        {
            settings = updated;
        }

        public void RetryFailed()
        {
            retryRequested = true;
        }

        // ─── Watching for tablets ───────────────────────────────────────────────

        public void Run()
        {
            var handled = new Dictionary<string, bool>(); // Serial to success, until it is unplugged
            DateTime waitingSince = DateTime.UtcNow;
            bool? lastResult = null; // Stays on screen until the next tablet, so an error can still be read after unplugging
            string lastModel = "";
            string shown = null;

            adb.Run("start-server", 20000);

            while (!stop.IsCancellationRequested)
            {
                List<AdbDevice> devices = adb.Devices();

                foreach (string gone in handled.Keys.Where(s => devices.All(d => d.Serial != s)).ToList())
                {
                    handled.Remove(gone);
                }
                if (retryRequested)
                {
                    retryRequested = false;
                    lastResult = null;
                    foreach (string failed in handled.Where(h => !h.Value).Select(h => h.Key).ToList())
                    {
                        handled.Remove(failed);
                    }
                }

                AdbDevice next = devices.FirstOrDefault(d => d.State == "device" && !handled.ContainsKey(d.Serial));
                if (next != null)
                {
                    bool ok = Provision(next.Serial);
                    handled[next.Serial] = ok;
                    lastResult = ok;
                    lastModel = model;
                    shown = null;
                    continue;
                }

                string state;
                if (devices.Any(d => d.State == "unauthorized")) state = "unauthorized";
                else if (devices.Any(d => d.State != "device")) state = "offline";
                else if (lastResult == false) state = "failed";
                else if (lastResult == true) state = "done";
                else if ((DateTime.UtcNow - waitingSince).TotalSeconds > NoTabletHintSeconds) state = "waiting-long";
                else state = "waiting";

                if (state == "unauthorized" || state == "offline") lastResult = null;
                if (state != "waiting" && state != "waiting-long") waitingSince = DateTime.UtcNow;
                if (state != shown)
                {
                    ShowIdle(state, lastModel);
                    shown = state;
                }

                stop.WaitHandle.WaitOne(1500);
            }
        }

        void ShowIdle(string state, string lastModel)
        {
            switch (state)
            {
                case "unauthorized":
                    view.ShowStatus("Hãy bấm Cho phép trên tablet",
                        "Tablet đang hỏi có cho máy tính này gỡ lỗi không. Chọn Luôn cho phép, rồi bấm Cho phép. Không thấy hỏi thì rút cáp cắm lại.",
                        Tone.Attention);
                    break;
                case "offline":
                    view.ShowStatus("Tablet chưa sẵn sàng", "Rút cáp rồi cắm lại.", Tone.Attention);
                    break;
                case "done":
                    view.ShowStatus("Xong: " + lastModel + " đã lên website", "Rút cáp rồi cắm tablet tiếp theo.", Tone.Success);
                    view.ShowRetry(false);
                    break;
                case "waiting-long":
                    view.ShowStatus("Đang chờ tablet",
                        "Đã cắm mà chưa thấy? Kiểm tra Gỡ lỗi USB đã bật, đổi sang cáp khác (cáp chỉ sạc không truyền dữ liệu), hoặc cài driver USB của Samsung cho máy tính này.",
                        Tone.Neutral);
                    view.ShowRetry(false);
                    break;
                case "waiting":
                    view.ShowStatus("Đang chờ tablet", "Bật Gỡ lỗi USB trên tablet rồi cắm cáp vào máy tính. Phần còn lại công cụ tự làm.", Tone.Neutral);
                    view.ShowRetry(false);
                    break;
            }
        }

        // ─── One tablet ─────────────────────────────────────────────────────────

        bool Provision(string tablet)
        {
            serial = tablet;
            model = tablet;
            sdk = 0;
            ownerPackage = null;
            Settings used = settings;

            view.ResetSteps();
            view.ShowRetry(false);
            try
            {
                Begin(Step.Connect);
                Connect();
                Finish(Step.Connect, model);

                view.ShowStatus("Đang cài " + model, "Đừng rút cáp. Không cần thao tác gì trên tablet.", Tone.Working);

                Begin(Step.Check);
                Check();
                Finish(Step.Check, ownerPackage == Package ? "Đã là Device Owner từ trước" : "Đủ điều kiện");

                Begin(Step.Install);
                InstallApp();

                Begin(Step.Owner);
                if (ownerPackage == Package)
                {
                    view.SetStep(Step.Owner, StepState.Skipped, "Đã đặt từ trước");
                }
                else
                {
                    SetOwner();
                    Finish(Step.Owner, "Đã đặt");
                }

                Begin(Step.Network);
                EnsureNetwork();
                EnsureClock();
                view.ShowStatus("Đang cài " + model, "Đừng rút cáp. Không cần thao tác gì trên tablet.", Tone.Working);
                Finish(Step.Network, "Đã có mạng");

                Begin(Step.Enroll);
                bool alreadyEnrolled = Enroll(used);
                Finish(Step.Enroll, alreadyEnrolled ? "Đã đăng ký từ trước" : "Website đã nhận");

                Begin(Step.Config);
                ApplyPinAndBackup(used);
                Finish(Step.Config, used.BackupPath != "" ? "Đã đặt PIN, đã áp " + Path.GetFileName(used.BackupPath) : "Đã đặt PIN");

                Begin(Step.Finish);
                WriteHistory("Thành công", alreadyEnrolled ? "Đã đăng ký từ trước" : "");
                string usbNote = "Gỡ lỗi USB vẫn bật";
                if (used.TurnOffUsbDebugging) usbNote = TurnOffUsbDebugging() ? "Đã tắt Gỡ lỗi USB" : "Chưa tắt được Gỡ lỗi USB";
                Finish(Step.Finish, usbNote);
                view.ShowStatus("Xong: " + model + " đã lên website", "Rút cáp rồi cắm tablet tiếp theo.", Tone.Success);
                view.TabletDone();
                view.Log("Xong " + model + " (" + serial + "). " + usbNote);
                return true;
            }
            catch (TabletProblem problem)
            {
                view.SetStep(currentStep, StepState.Failed, problem.Message);
                view.ShowStatus(problem.Message, problem.Detail, Tone.Problem);
                view.ShowRetry(true);
                view.Log("Dừng ở " + currentStep + ": " + problem.Message + ". " + problem.Detail);
                WriteHistory("Lỗi", problem.Message);
                return false;
            }
            catch (TabletGone)
            {
                view.SetStep(currentStep, StepState.Failed, "Mất kết nối");
                view.ShowStatus("Tablet đã bị rút", "Cắm lại, công cụ sẽ làm tiếp. Các bước đã xong không bị làm hỏng.", Tone.Attention);
                view.ShowRetry(true);
                view.Log("Mất kết nối với " + serial + " ở bước " + currentStep);
                return false;
            }
            catch (OperationCanceledException)
            {
                return false;
            }
        }

        void Begin(Step step)
        {
            currentStep = step;
            view.SetStep(step, StepState.Running, "");
        }

        void Finish(Step step, string note)
        {
            view.SetStep(step, StepState.Done, note);
        }

        void Connect()
        {
            model = Prop("ro.product.model");
            string android = Prop("ro.build.version.release");
            int.TryParse(Prop("ro.build.version.sdk"), out sdk);
            view.Log("Thấy " + model + ", Android " + android + ", số máy " + serial);

            // Plugged in while still starting up: most commands would fail for no good reason
            for (int i = 0; i < 60 && Prop("sys.boot_completed") != "1"; i++) Wait(2);
        }

        void Check()
        {
            string[] owner = ReadOwner();
            if (owner != null && owner[0] == Package && owner[1] == "DeviceOwner")
            {
                ownerPackage = Package;
                return;
            }
            if (owner != null)
            {
                throw new TabletProblem("Tablet đang do ứng dụng khác quản lý",
                    owner[0] + " đang quản lý máy này. Chỉ khôi phục cài đặt gốc mới gỡ được. Làm xong thì bỏ qua bước đăng nhập, bật Gỡ lỗi USB rồi cắm lại.");
            }

            if (!Sh("pm list features").Contains("android.software.device_admin"))
            {
                throw new TabletProblem("Máy này không hỗ trợ Device Owner",
                    "ROM của máy thiếu android.software.device_admin. Xem scripts/set-device-owner.ps1 trong mã nguồn để biết cách xử lý.");
            }

            int users = Regex.Matches(Sh("pm list users"), @"UserInfo\{").Count;
            if (users > 1)
            {
                throw new TabletProblem("Tablet có nhiều người dùng",
                    "Máy có " + users + " người dùng hoặc hồ sơ, ví dụ Thư mục bảo mật. Hãy khôi phục cài đặt gốc rồi cắm lại.");
            }

            Match accounts = Regex.Match(Sh("dumpsys account"), @"Accounts:\s*(\d+)");
            if (accounts.Success && accounts.Groups[1].Value != "0")
            {
                throw new TabletProblem("Tablet đang có tài khoản",
                    "Android chỉ cho đặt Device Owner khi máy không có tài khoản nào, và máy này có " + accounts.Groups[1].Value + ". Hãy khôi phục cài đặt gốc, bỏ qua bước đăng nhập, bật Gỡ lỗi USB rồi cắm lại.");
            }
        }

        /// <summary>Package and kind of whoever owns the device, or null. dpm list-owners is Android 11 and later.</summary>
        string[] ReadOwner()
        {
            string output = Sh("dpm list-owners");
            if (output.Contains("no owners")) return null;

            Match listed = Regex.Match(output, @"admin=([\w.]+)/[^,\s]*,(DeviceOwner|ProfileOwner)");
            if (listed.Success) return new[] { listed.Groups[1].Value, listed.Groups[2].Value };

            Match dumped = Regex.Match(Sh("dumpsys device_policy"), @"Device Owner:\s*\r?\n\s*admin=ComponentInfo\{([\w.]+)/");
            return dumped.Success ? new[] { dumped.Groups[1].Value, "DeviceOwner" } : null;
        }

        void InstallApp()
        {
            view.SetStep(Step.Install, StepState.Running, "Đang chép ứng dụng sang tablet");
            CommandResult result = adb.Install(serial, apkPath, 300000);
            ThrowIfDisconnected(result);

            if (result.Output.Contains("Success"))
            {
                view.Log("Đã cài FreeKiosk");
                Finish(Step.Install, "Đã cài");
            }
            else
            {
                string code = Regex.Match(result.Output, @"INSTALL_[A-Z_]+").Value;
                view.Log("adb install: " + result.Output.Trim());
                switch (code)
                {
                    case "INSTALL_FAILED_VERSION_DOWNGRADE":
                        view.Log("Tablet đang có bản mới hơn, giữ nguyên");
                        Finish(Step.Install, "Đã có bản mới hơn");
                        break;
                    case "INSTALL_FAILED_UPDATE_INCOMPATIBLE":
                        throw new TabletProblem("Tablet đang có FreeKiosk của nguồn khác",
                            "Bản đang cài được ký bằng khóa khác nên không cập nhật được. Gỡ bản đó trên tablet rồi cắm lại. Nếu nó đang là Device Owner thì cần khôi phục cài đặt gốc.");
                    case "INSTALL_FAILED_USER_RESTRICTED":
                    case "INSTALL_FAILED_VERIFICATION_FAILURE":
                    case "INSTALL_FAILED_VERIFICATION_TIMEOUT":
                    case "INSTALL_FAILED_ABORTED":
                        throw new TabletProblem("Tablet từ chối cài ứng dụng",
                            "Nhìn màn hình tablet: nếu Play Protect hỏi thì chọn cài đặt. Nếu Trình chặn tự động đang bật, hãy tắt trong phần Bảo mật và quyền riêng tư. Xong thì bấm Thử lại.");
                    case "INSTALL_FAILED_INSUFFICIENT_STORAGE":
                        throw new TabletProblem("Tablet hết dung lượng", "Xóa bớt dữ liệu trên tablet rồi bấm Thử lại.");
                    default:
                        if (code.StartsWith("INSTALL_PARSE_FAILED", StringComparison.Ordinal))
                        {
                            throw new TabletProblem("Tệp FreeKiosk.apk bị hỏng", "Hãy lấy lại thư mục công cụ rồi thử lại.");
                        }
                        throw new TabletProblem("Không cài được ứng dụng",
                            "Android báo: " + (code != "" ? code : result.Output.Trim()) + ". Xem chi tiết ở nhật ký bên dưới.");
                }
            }

            // What Permission Wizard would otherwise ask someone to tap through on the tablet.
            // Runtime permissions came with install -g; none of these can stop the enrollment.
            Try("pm grant " + Package + " android.permission.WRITE_SECURE_SETTINGS");
            Try("appops set " + Package + " SYSTEM_ALERT_WINDOW allow");
            Try("appops set " + Package + " GET_USAGE_STATS allow");
            Try("appops set " + Package + " WRITE_SETTINGS allow");
            Try("cmd deviceidle whitelist +" + Package);
        }

        void Try(string command)
        {
            CommandResult result = adb.Shell(serial, command, 20000);
            ThrowIfDisconnected(result);
            if (result.ExitCode != 0) view.Log("Không chạy được: " + command + " (" + result.Output.Trim() + ")");
        }

        void SetOwner()
        {
            string output = Sh("dpm set-device-owner " + AdminComponent);
            string[] owner = ReadOwner();
            if (owner != null && owner[0] == Package && owner[1] == "DeviceOwner")
            {
                view.Log("Đã đặt Device Owner");
                return;
            }

            view.Log("dpm: " + output);
            if (output.Contains("accounts"))
            {
                throw new TabletProblem("Tablet đang có tài khoản",
                    "Android từ chối vì máy có tài khoản. Hãy khôi phục cài đặt gốc, bỏ qua bước đăng nhập, bật Gỡ lỗi USB rồi cắm lại.");
            }
            if (output.Contains("users"))
            {
                throw new TabletProblem("Tablet có nhiều người dùng", "Hãy khôi phục cài đặt gốc rồi cắm lại.");
            }
            throw new TabletProblem("Không đặt được Device Owner",
                "Android từ chối, xem chi tiết ở nhật ký bên dưới. Cách chắc nhất là khôi phục cài đặt gốc, bỏ qua bước đăng nhập, bật Gỡ lỗi USB rồi cắm lại.");
        }

        void EnsureNetwork()
        {
            if (HasNetwork()) return;

            string tried = null;
            bool openedOnTablet = false;
            DateTime deadline = DateTime.UtcNow.AddSeconds(NetworkWaitSeconds);
            while (DateTime.UtcNow < deadline)
            {
                // Read each time: the operator can correct the Wi-Fi in Thiết lập while this waits
                Settings current = settings;
                string wifi = current.WifiName + "\n" + current.WifiPassword;
                if (current.WifiName != "" && wifi != tried)
                {
                    tried = wifi;
                    if (ConnectWifi(current)) return;
                    view.SetStep(Step.Network, StepState.Running, "Chưa nối được " + current.WifiName);
                    view.ShowStatus("Chưa nối được Wi-Fi " + current.WifiName,
                        "Kiểm tra lại tên và mật khẩu: bấm Thiết lập để sửa, công cụ sẽ tự nối lại. Hoặc nối Wi-Fi ngay trên tablet.", Tone.Attention);
                }
                else if (tried == null && !openedOnTablet)
                {
                    view.SetStep(Step.Network, StepState.Running, "Chờ có Wi-Fi");
                    view.ShowStatus("Tablet chưa có mạng",
                        "Bấm Thiết lập để nhập tên và mật khẩu Wi-Fi, công cụ sẽ tự nối cho tablet này và các tablet sau. Hoặc nối Wi-Fi ngay trên tablet.", Tone.Attention);
                }

                if (!openedOnTablet)
                {
                    openedOnTablet = true;
                    Try("cmd wifi set-wifi-enabled enabled");
                    Try("am start -a android.settings.WIFI_SETTINGS");
                }

                if (HasNetwork()) return;
                Wait(2);
            }

            throw new TabletProblem("Tablet chưa có mạng", "Bấm Thiết lập để nhập Wi-Fi, hoặc nối Wi-Fi trên tablet, rồi bấm Thử lại.");
        }

        bool ConnectWifi(Settings current)
        {
            view.SetStep(Step.Network, StepState.Running, "Đang nối " + current.WifiName);
            view.Log("Tablet chưa có mạng, nối Wi-Fi " + current.WifiName);

            // Wi-Fi is off after a setup that skipped it, and connecting fails while it is still turning on
            Try("cmd wifi set-wifi-enabled enabled");
            DateTime enabling = DateTime.UtcNow.AddSeconds(WifiEnableSeconds);
            while (DateTime.UtcNow < enabling && !Sh("cmd wifi status").Contains("Wifi is enabled")) Wait(1);

            string security = current.WifiPassword == "" ? "open" : "wpa2 " + Adb.RemoteQuote(current.WifiPassword);
            CommandResult result = adb.Shell(serial, "cmd wifi connect-network " + Adb.RemoteQuote(current.WifiName) + " " + security, 20000);
            ThrowIfDisconnected(result);
            if (result.ExitCode != 0)
            {
                string said = result.Output.Trim();
                view.Log("Lệnh nối Wi-Fi báo lỗi: " + (current.WifiPassword == "" ? said : said.Replace(current.WifiPassword, "***")));
                return false;
            }
            if (WaitForNetwork(WifiTimeoutSeconds))
            {
                view.Log("Đã nối Wi-Fi " + current.WifiName);
                return true;
            }
            view.Log("Sau " + WifiTimeoutSeconds + " giây vẫn chưa nối được Wi-Fi " + current.WifiName);
            return false;
        }

        bool WaitForNetwork(int seconds)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < deadline)
            {
                if (HasNetwork()) return true;
                Wait(2);
            }
            return false;
        }

        bool HasNetwork()
        {
            return Regex.IsMatch(Sh("dumpsys connectivity | grep 'Active default network'"), @"Active default network:\s*\d+");
        }

        /// <summary>A tablet set up without Wi-Fi keeps the date of its firmware, and HTTPS refuses every certificate until it corrects itself.</summary>
        void EnsureClock()
        {
            if (ClockIsRight()) return;
            view.SetStep(Step.Network, StepState.Running, "Chờ tablet chỉnh đồng hồ");
            Try("settings put global auto_time 1");
            DateTime deadline = DateTime.UtcNow.AddSeconds(ClockTimeoutSeconds);
            while (DateTime.UtcNow < deadline)
            {
                if (ClockIsRight()) return;
                Wait(3);
            }
            view.Log("Đồng hồ tablet vẫn sai sau " + ClockTimeoutSeconds + " giây, vẫn thử đăng ký");
        }

        bool ClockIsRight()
        {
            long tablet;
            if (!long.TryParse(Sh("date +%s"), out tablet)) return true;
            long now = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
            return Math.Abs(tablet - now) < 300;
        }

        /// <returns>True when the tablet turned out to be enrolled already.</returns>
        bool Enroll(Settings used)
        {
            view.SetStep(Step.Enroll, StepState.Running, "Đang gửi mã đăng ký");

            // The screen may have gone off during the install, and an activity cannot start behind the lock screen
            Try("input keyevent KEYCODE_WAKEUP");
            Try("wm dismiss-keyguard");

            Sh("logcat -c");
            Launch("--es pin " + Adb.RemoteQuote(used.Pin)
                + " --es cloud_url " + Adb.RemoteQuote(used.ServerUrl)
                + " --es cloud_token " + Adb.RemoteQuote(used.Token));
            view.Log("Đã mở FreeKiosk với mã đăng ký, chờ website trả lời");

            bool saidUnreachable = false;
            DateTime deadline = DateTime.UtcNow.AddSeconds(EnrollTimeoutSeconds);
            while (DateTime.UtcNow < deadline)
            {
                string logs = AppLogs();
                ThrowIfPinRejected(logs);
                if (logs.Contains(LogAccepted))
                {
                    view.Log("Website đã nhận tablet");
                    return false;
                }
                if (logs.Contains(LogDiscarded))
                {
                    view.Log("Tablet đã đăng ký từ trước, không dùng thêm lượt của mã");
                    return true;
                }
                Match refused = Regex.Match(logs, Regex.Escape(LogRefused) + @"(.*)");
                if (refused.Success)
                {
                    throw new TabletProblem("Website từ chối mã đăng ký",
                        refused.Groups[1].Value.Trim() + ". Trên website, vào Thêm thiết bị, Tiêu chuẩn, đặt Số máy được dùng rồi Tạo mã. Bấm Thiết lập để dán mã mới, rồi bấm Thử lại.");
                }
                if (!saidUnreachable && logs.Contains(LogUnreachable))
                {
                    saidUnreachable = true;
                    view.SetStep(Step.Enroll, StepState.Running, "Tablet chưa gọi được website, đang thử lại");
                    view.Log("Tablet chưa gọi được website, FreeKiosk sẽ tự thử lại");
                }
                Wait(2);
            }

            string host = new Uri(used.ServerUrl).Host;
            string detail = "Sau " + EnrollTimeoutSeconds + " giây tablet vẫn chưa gọi được " + host + ". Kiểm tra Wi-Fi của tablet có ra được Internet không. FreeKiosk vẫn tự thử lại, nên tablet có thể hiện trên website sau ít phút.";
            if (sdk > 0 && sdk < MinimumTls13Sdk) detail += " Máy này chạy Android dưới 10, không có TLS 1.3 mà website yêu cầu.";
            throw new TabletProblem("Chưa đăng ký được", detail);
        }

        /// <summary>
        /// Enrolling wipes the settings it finds, the PIN from the command that queued it
        /// included, which would leave the default 1234 in place. Sent again afterwards. The backup
        /// file has to wait for the same reason, and the same restart of the app applies it.
        /// </summary>
        void ApplyPinAndBackup(Settings used)
        {
            view.SetStep(Step.Config, StepState.Running, used.BackupPath != "" ? "Đang áp tệp cấu hình và đặt PIN" : "Đang đặt PIN");

            // Before the push: the running app can pick the file up at any moment after it
            Sh("logcat -c");
            bool backupDone = used.BackupPath == "";
            if (!backupDone) PushBackup(used);
            Launch("--es pin " + Adb.RemoteQuote(used.Pin));

            bool pinDone = false;
            DateTime deadline = DateTime.UtcNow.AddSeconds(PinTimeoutSeconds);
            while (DateTime.UtcNow < deadline)
            {
                string logs = AppLogs();
                ThrowIfPinRejected(logs);
                Match refused = Regex.Match(logs, Regex.Escape(LogBackupRefused) + @"(.*)");
                if (refused.Success)
                {
                    throw new TabletProblem("Tablet từ chối tệp cấu hình",
                        refused.Groups[1].Value.Trim() + ". Hãy xuất lại tệp từ Cài đặt, Nâng cao, Sao lưu và khôi phục, chọn lại trong Thiết lập, rồi bấm Thử lại.");
                }
                if (!backupDone && logs.Contains(LogBackupApplied))
                {
                    backupDone = true;
                    view.Log("Đã áp tệp cấu hình " + Path.GetFileName(used.BackupPath));
                }
                if (!pinDone && logs.Contains(LogPinSaved))
                {
                    pinDone = true;
                    view.Log("Đã đặt PIN trên tablet");
                }
                if (pinDone && backupDone) return;
                if (logs.Contains(LogPinFailed)) break;
                Wait(2);
            }

            if (!pinDone)
            {
                throw new TabletProblem("Chưa đặt được PIN",
                    "Tablet đã lên website nhưng PIN vẫn là mặc định 1234. Bấm Thử lại, hoặc đặt PIN trong Cài đặt của FreeKiosk trên tablet.");
            }
            throw new TabletProblem("Chưa áp được tệp cấu hình", "Sau " + PinTimeoutSeconds + " giây tablet vẫn chưa báo đã áp tệp. Bấm Thử lại.");
        }

        /// <summary>Into the app's own files folder: adb can write there and the app needs no permission to read it.</summary>
        void PushBackup(Settings used)
        {
            if (!File.Exists(used.BackupPath))
            {
                throw new TabletProblem("Không thấy tệp cấu hình", "Không còn tệp " + used.BackupPath + ". Bấm Thiết lập để chọn lại, rồi bấm Thử lại.");
            }
            string folder = "/sdcard/Android/data/" + Package + "/files";
            Sh("mkdir -p " + folder);
            CommandResult result = adb.Push(serial, used.BackupPath, folder + "/provisioning-backup.json", 60000);
            ThrowIfDisconnected(result);
            if (result.ExitCode != 0)
            {
                view.Log("adb push: " + result.Output.Trim());
                throw new TabletProblem("Không chép được tệp cấu hình sang tablet", "Xem chi tiết ở nhật ký bên dưới, rồi bấm Thử lại.");
            }
        }

        /// <summary>Last of all, since it ends the connection: still being able to ask means it did not work.</summary>
        bool TurnOffUsbDebugging()
        {
            adb.Shell(serial, "settings put global development_settings_enabled 0; settings put global adb_enabled 0", 8000);
            Wait(2);
            CommandResult check = adb.Shell(serial, "settings get global adb_enabled", 5000);
            return check.ExitCode != 0 || check.Output.Trim() == "0";
        }

        void Launch(string extras)
        {
            string output = Sh("am start -n " + Package + "/.MainActivity " + extras);
            if (output.Contains("Error:"))
            {
                view.Log("am start: " + output);
                throw new TabletProblem("Không mở được FreeKiosk", "Xem chi tiết ở nhật ký bên dưới, rồi bấm Thử lại.");
            }
        }

        void ThrowIfPinRejected(string logs)
        {
            if (logs.Contains(LogPinRejected))
            {
                throw new TabletProblem("PIN không khớp",
                    "Tablet này từng được đặt PIN khác nên FreeKiosk từ chối cấu hình. Nhập đúng PIN đó trong Thiết lập rồi bấm Thử lại, hoặc khôi phục cài đặt gốc.");
            }
        }

        string AppLogs()
        {
            return Sh("logcat -d -s ReactNativeJS:V FreeKiosk-ADB:V");
        }

        // ─── Helpers ────────────────────────────────────────────────────────────

        string Prop(string name)
        {
            return Sh("getprop " + name);
        }

        string Sh(string command)
        {
            stop.ThrowIfCancellationRequested();
            CommandResult result = adb.Shell(serial, command, 30000);
            ThrowIfDisconnected(result);
            return result.Output.Trim();
        }

        static void ThrowIfDisconnected(CommandResult result)
        {
            if (result.ExitCode != 0 && Regex.IsMatch(result.Output, @"not found|no devices|device offline|device unauthorized|error: closed|protocol fault", RegexOptions.IgnoreCase)
                && Regex.IsMatch(result.Output, @"^(adb: |error: |adb\.exe: )", RegexOptions.Multiline))
            {
                throw new TabletGone();
            }
        }

        void Wait(int seconds)
        {
            if (stop.WaitHandle.WaitOne(seconds * 1000)) throw new OperationCanceledException();
        }

        void WriteHistory(string result, string note)
        {
            try
            {
                Directory.CreateDirectory(Settings.DataFolder);
                string path = HistoryPath;
                string[] fields = { DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), serial, model, result, note };
                string line = string.Join(",", fields.Select(f => "\"" + f.Replace("\"", "\"\"") + "\"")) + Environment.NewLine;
                if (!File.Exists(path)) line = "Thời gian,Số máy,Kiểu máy,Kết quả,Ghi chú" + Environment.NewLine + line;
                File.AppendAllText(path, line, new UTF8Encoding(true));
            }
            catch (IOException e)
            {
                view.Log("Không ghi được lịch sử: " + e.Message); // Open in Excel, usually
            }
        }

        public static string HistoryPath
        {
            get { return Path.Combine(Settings.DataFolder, "lich-su.csv"); }
        }
    }
}
