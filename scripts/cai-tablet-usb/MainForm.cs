using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace CaiTablet
{
    sealed class MainForm : Form, IInstallerView
    {
        static readonly Color Brand = Color.FromArgb(29, 98, 216);
        static readonly Color Ink = Color.FromArgb(28, 36, 48);
        static readonly Color Soft = Color.FromArgb(95, 105, 120);
        static readonly Color Page = Color.FromArgb(246, 247, 249);
        static readonly string[] Spinner = { "◐", "◓", "◑", "◒" };
        static readonly object LogFileLock = new object();

        static readonly KeyValuePair<Step, string>[] StepNames =
        {
            new KeyValuePair<Step, string>(Step.Connect, "Kết nối tablet"),
            new KeyValuePair<Step, string>(Step.Check, "Kiểm tra máy"),
            new KeyValuePair<Step, string>(Step.Install, "Cài FreeKiosk"),
            new KeyValuePair<Step, string>(Step.Owner, "Đặt Device Owner"),
            new KeyValuePair<Step, string>(Step.Network, "Kiểm tra mạng"),
            new KeyValuePair<Step, string>(Step.Enroll, "Đăng ký lên website"),
            new KeyValuePair<Step, string>(Step.Config, "Đặt PIN và cấu hình"),
            new KeyValuePair<Step, string>(Step.Finish, "Hoàn tất"),
        };

        readonly Label serverLabel = new Label { AutoSize = false, AutoEllipsis = true, Height = 22, ForeColor = Color.FromArgb(214, 228, 255) };
        readonly Panel statusBar = new Panel { Dock = DockStyle.Left, Width = 6 };
        readonly Label statusTitle = new Label { AutoSize = false, AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Ink };
        readonly Label statusDetail = new Label { Dock = DockStyle.Fill, AutoSize = false, ForeColor = Soft };
        readonly Button retryButton = new Button { Text = "Thử lại", AutoSize = true, MinimumSize = new Size(96, 30), Visible = false };
        readonly Label countLabel = new Label { AutoSize = true, ForeColor = Soft };
        readonly TextBox logBox = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, BorderStyle = BorderStyle.None, BackColor = Color.White, ForeColor = Soft };
        readonly Dictionary<Step, Label> stepIcons = new Dictionary<Step, Label>();
        readonly Dictionary<Step, Label> stepNotes = new Dictionary<Step, Label>();
        readonly CancellationTokenSource stop = new CancellationTokenSource();
        readonly System.Windows.Forms.Timer spinnerTimer = new System.Windows.Forms.Timer { Interval = 180 };

        Settings settings;
        Installer installer;
        Thread worker;
        Adb adb;
        Step? spinning;
        int spinnerFrame;
        int doneCount;
        bool closing;

        public MainForm()
        {
            Text = "Cài tablet FreeKiosk qua USB";
            Font = new Font("Segoe UI", 9.75f);
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96f, 96f);
            ClientSize = new Size(900, 660);
            MinimumSize = new Size(820, 600);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Page;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch (ArgumentException) { }

            BuildLayout();
            statusTitle.Font = new Font("Segoe UI Semibold", 15f);
            logBox.Font = new Font("Consolas", 9f);

            spinnerTimer.Tick += delegate
            {
                if (spinning == null) return;
                spinnerFrame = (spinnerFrame + 1) % Spinner.Length;
                stepIcons[spinning.Value].Text = Spinner[spinnerFrame];
            };
            spinnerTimer.Start();

            Shown += OnShown;
            FormClosing += OnClosing;
        }

        // ─── Layout ─────────────────────────────────────────────────────────────

        void BuildLayout()
        {
            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(0), Margin = new Padding(0) };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 160));
            root.Controls.Add(BuildHeader(), 0, 0);
            root.Controls.Add(BuildBody(), 0, 1);
            root.Controls.Add(BuildLog(), 0, 2);
            Controls.Add(root);
        }

        Control BuildHeader()
        {
            var header = new Panel { Dock = DockStyle.Fill, BackColor = Brand, Margin = new Padding(0) };
            var title = new Label { Text = "Cài tablet FreeKiosk qua USB", AutoSize = true, ForeColor = Color.White, Font = new Font("Segoe UI Semibold", 14f), Location = new Point(20, 10) };
            serverLabel.Location = new Point(21, 41);
            var settingsButton = new Button { Text = "Thiết lập", AutoSize = true, MinimumSize = new Size(96, 32), FlatStyle = FlatStyle.Flat, ForeColor = Color.White, BackColor = Brand, Anchor = AnchorStyles.Top | AnchorStyles.Right };
            settingsButton.FlatAppearance.BorderColor = Color.FromArgb(150, 185, 245);
            settingsButton.Click += delegate { OpenSettings(); };
            var historyButton = new Button { Text = "Lịch sử", AutoSize = true, MinimumSize = new Size(96, 32), FlatStyle = FlatStyle.Flat, ForeColor = Color.White, BackColor = Brand, Anchor = AnchorStyles.Top | AnchorStyles.Right };
            historyButton.FlatAppearance.BorderColor = Color.FromArgb(150, 185, 245);
            historyButton.Click += delegate { OpenHistory(); };

            var actions = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Anchor = AnchorStyles.Top | AnchorStyles.Right, BackColor = Brand };
            actions.Controls.Add(settingsButton);
            actions.Controls.Add(historyButton);
            header.Controls.Add(actions);
            header.Controls.Add(title);
            header.Controls.Add(serverLabel);
            header.Resize += delegate
            {
                actions.Location = new Point(header.ClientSize.Width - actions.Width - 14, (header.ClientSize.Height - actions.Height) / 2);
                serverLabel.Width = Math.Max(100, actions.Left - serverLabel.Left - 12);
            };
            return header;
        }

        Control BuildBody()
        {
            var body = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Padding = new Padding(14, 14, 14, 6), Margin = new Padding(0) };
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60));
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));
            body.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

            var left = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = new Padding(0, 0, 7, 0), Padding = new Padding(0) };
            left.RowStyles.Add(new RowStyle(SizeType.Absolute, 136));
            left.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            left.Controls.Add(BuildStatusCard(), 0, 0);
            left.Controls.Add(BuildSteps(), 0, 1);

            body.Controls.Add(left, 0, 0);
            body.Controls.Add(BuildGuide(), 1, 0);
            return body;
        }

        Control BuildStatusCard()
        {
            var card = Card(new Padding(0, 0, 0, 7));
            var inner = new Panel { Dock = DockStyle.Fill, Padding = new Padding(14, 8, 12, 8), BackColor = Color.White };
            var top = new Panel { Dock = DockStyle.Top, Height = 40, BackColor = Color.White };
            retryButton.Dock = DockStyle.Right;
            retryButton.Click += delegate
            {
                if (installer != null) installer.RetryFailed();
                retryButton.Visible = false;
            };
            statusTitle.Dock = DockStyle.Fill;
            top.Controls.Add(statusTitle);
            top.Controls.Add(retryButton);
            inner.Controls.Add(statusDetail);
            inner.Controls.Add(top);
            card.Controls.Add(inner);
            card.Controls.Add(statusBar);
            return card;
        }

        Control BuildSteps()
        {
            var card = Card(new Padding(0, 7, 0, 0));
            var table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = StepNames.Length, Padding = new Padding(14, 8, 12, 8), BackColor = Color.White };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 30));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            for (int i = 0; i < StepNames.Length; i++)
            {
                table.RowStyles.Add(new RowStyle(SizeType.Percent, 100f / StepNames.Length));
                Step step = StepNames[i].Key;
                var icon = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Segoe UI Symbol", 11f), Margin = new Padding(0) };
                var name = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Text = StepNames[i].Value, ForeColor = Ink, Margin = new Padding(0) };
                var note = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Soft, Margin = new Padding(0), AutoEllipsis = true };
                stepIcons[step] = icon;
                stepNotes[step] = note;
                table.Controls.Add(icon, 0, i);
                table.Controls.Add(name, 1, i);
                table.Controls.Add(note, 2, i);
            }
            ClearSteps();
            card.Controls.Add(table);
            return card;
        }

        Control BuildGuide()
        {
            var card = Card(new Padding(7, 0, 0, 0));
            var inner = new Panel { Dock = DockStyle.Fill, Padding = new Padding(14, 12, 14, 10), BackColor = Color.White };
            var title = new Label { Text = "Chuẩn bị tablet", Dock = DockStyle.Top, Height = 28, Font = new Font("Segoe UI Semibold", 11f), ForeColor = Ink };
            // With the lines each one takes, so a longer step gets the room it needs
            var steps = new[]
            {
                new KeyValuePair<string, int>("1. Khôi phục cài đặt gốc nếu máy đã dùng.", 2),
                new KeyValuePair<string, int>("2. Đi hết các bước thiết lập, bỏ qua Wi-Fi, không đăng nhập tài khoản nào.", 2),
                new KeyValuePair<string, int>("3. Vào Cài đặt, Thông tin máy tính bảng, Thông tin phần mềm. Chạm 7 lần vào Số hiệu bản tạo.", 3),
                new KeyValuePair<string, int>("4. Quay lại Cài đặt, vào Tùy chọn cho nhà phát triển, bật Gỡ lỗi USB.", 2),
                new KeyValuePair<string, int>("5. Cắm cáp vào máy tính này, rồi bấm Cho phép trên tablet.", 2),
            };
            var guide = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = steps.Length, BackColor = Color.White };
            foreach (KeyValuePair<string, int> step in steps)
            {
                guide.RowStyles.Add(new RowStyle(SizeType.Percent, step.Value));
                guide.Controls.Add(new Label { Dock = DockStyle.Fill, Text = step.Key, ForeColor = Ink, Margin = new Padding(0), TextAlign = ContentAlignment.MiddleLeft });
            }
            countLabel.Dock = DockStyle.Bottom;
            countLabel.AutoSize = false;
            countLabel.Height = 26;
            countLabel.TextAlign = ContentAlignment.MiddleLeft;
            countLabel.Text = "Đã cài xong trong lần mở này: 0 tablet";
            inner.Controls.Add(guide);
            inner.Controls.Add(countLabel);
            inner.Controls.Add(title);
            card.Controls.Add(inner);
            return card;
        }

        Control BuildLog()
        {
            var wrap = new Panel { Dock = DockStyle.Fill, Padding = new Padding(14, 6, 14, 14), Margin = new Padding(0), BackColor = Page };
            var border = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(10, 8, 6, 8) };
            border.Controls.Add(logBox);
            wrap.Controls.Add(border);
            return wrap;
        }

        static Panel Card(Padding margin)
        {
            return new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Margin = margin };
        }

        // ─── Life of the window ─────────────────────────────────────────────────

        void OnShown(object sender, EventArgs e)
        {
            string folder = AppDomain.CurrentDomain.BaseDirectory;
            string adbPath = Environment.GetEnvironmentVariable("CAITABLET_ADB");
            if (string.IsNullOrEmpty(adbPath)) adbPath = Path.Combine(folder, "adb", "adb.exe");
            string apkPath = Path.Combine(folder, "FreeKiosk.apk");
            if (!File.Exists(adbPath) || !File.Exists(apkPath))
            {
                ShowStatus("Thiếu tệp đi kèm", "Không thấy " + (File.Exists(adbPath) ? "FreeKiosk.apk" : "adb\\adb.exe") + " cạnh công cụ. Hãy giải nén lại cả thư mục rồi mở lại.", Tone.Problem);
                return;
            }
            adb = new Adb(adbPath);

            settings = Settings.Load();
            UpdateServerLabel();
            if (!settings.IsComplete && !OpenSettings())
            {
                ShowStatus("Chưa thiết lập", "Bấm Thiết lập để nhập mã đăng ký và PIN. Công cụ cần hai thứ này để đăng ký tablet.", Tone.Attention);
                return;
            }
            StartWorker();
        }

        void StartWorker()
        {
            // Saving the first settings starts it too: two would install every tablet twice at once
            if (installer != null) return;
            installer = new Installer(adb, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "FreeKiosk.apk"), settings, this, stop.Token);
            worker = new Thread(RunWorker) { IsBackground = true, Name = "installer" };
            worker.Start();
        }

        void RunWorker()
        {
            try
            {
                installer.Run();
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception e)
            {
                Log("Lỗi không lường trước: " + e);
                ShowStatus("Công cụ gặp lỗi", e.Message + ". Hãy đóng rồi mở lại công cụ, và gửi nhật ký nếu lỗi lặp lại.", Tone.Problem);
            }
        }

        bool OpenSettings()
        {
            using (var form = new SettingsForm(settings ?? new Settings()))
            {
                if (form.ShowDialog(this) != DialogResult.OK) return false;
                settings = form.Result;
            }
            UpdateServerLabel();
            if (installer != null) installer.UseSettings(settings);
            else if (adb != null) StartWorker();
            return true;
        }

        void OpenHistory()
        {
            string path = Installer.HistoryPath;
            if (!File.Exists(path))
            {
                MessageBox.Show(this, "Chưa có tablet nào được cài.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        }

        void UpdateServerLabel()
        {
            Uri parsed;
            string website = Uri.TryCreate(settings.ServerUrl, UriKind.Absolute, out parsed) ? parsed.Host : settings.ServerUrl;
            string config = settings.BackupPath != "" ? "tệp " + Path.GetFileName(settings.BackupPath) : settings.TokenNote != "" ? settings.TokenNote : "theo mã đăng ký";
            serverLabel.Text = "Website: " + website + "   ·   Wi-Fi: " + (settings.WifiName != "" ? settings.WifiName : "chưa nhập") + "   ·   Cấu hình: " + config;
        }

        void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (spinning != null && !closing && e.CloseReason == CloseReason.UserClosing)
            {
                if (MessageBox.Show(this, "Công cụ đang cài dở một tablet. Vẫn đóng?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                {
                    e.Cancel = true;
                    return;
                }
            }
            closing = true;
            stop.Cancel();
            if (worker != null) worker.Join(2500);
            // So the folder can be moved or deleted afterwards
            if (adb != null) adb.Run("kill-server", 5000);
        }

        // ─── IInstallerView, called from the worker thread ──────────────────────

        void Ui(Action action)
        {
            if (closing || IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke(action); }
            catch (InvalidOperationException) { }
        }

        public void ShowStatus(string title, string detail, Tone tone)
        {
            Ui(delegate
            {
                statusTitle.Text = title;
                statusDetail.Text = detail;
                statusBar.BackColor = ToneColor(tone);
                statusTitle.ForeColor = tone == Tone.Problem ? Color.FromArgb(180, 40, 40) : tone == Tone.Success ? Color.FromArgb(22, 120, 70) : Ink;
            });
            WriteLogFile("Trạng thái: " + title + ". " + detail);
        }

        public void ResetSteps()
        {
            Ui(delegate { ClearSteps(); });
        }

        public void SetStep(Step step, StepState state, string note)
        {
            Ui(delegate
            {
                Label icon = stepIcons[step];
                stepNotes[step].Text = note;
                switch (state)
                {
                    case StepState.Running:
                        spinning = step;
                        icon.Text = Spinner[spinnerFrame];
                        icon.ForeColor = Brand;
                        break;
                    case StepState.Done:
                        if (spinning == step) spinning = null;
                        icon.Text = "✓";
                        icon.ForeColor = Color.FromArgb(22, 140, 80);
                        break;
                    case StepState.Skipped:
                        if (spinning == step) spinning = null;
                        icon.Text = "–";
                        icon.ForeColor = Soft;
                        break;
                    case StepState.Failed:
                        if (spinning == step) spinning = null;
                        icon.Text = "✕";
                        icon.ForeColor = Color.FromArgb(190, 45, 45);
                        break;
                }
            });
            if (state == StepState.Done || state == StepState.Failed) WriteLogFile("Bước " + step + ": " + state + " " + note);
        }

        void ClearSteps()
        {
            spinning = null;
            foreach (KeyValuePair<Step, string> pair in StepNames)
            {
                stepIcons[pair.Key].Text = "○";
                stepIcons[pair.Key].ForeColor = Color.FromArgb(170, 178, 190);
                stepNotes[pair.Key].Text = "";
            }
        }

        public void Log(string line)
        {
            string stamped = DateTime.Now.ToString("HH:mm:ss") + "  " + line;
            Ui(delegate { logBox.AppendText(stamped + Environment.NewLine); });
            WriteLogFile(line);
        }

        public void ShowRetry(bool visible)
        {
            Ui(delegate { retryButton.Visible = visible; });
        }

        public void TabletDone()
        {
            Ui(delegate
            {
                doneCount++;
                countLabel.Text = "Đã cài xong trong lần mở này: " + doneCount + " tablet";
            });
        }

        static Color ToneColor(Tone tone)
        {
            switch (tone)
            {
                case Tone.Working: return Brand;
                case Tone.Success: return Color.FromArgb(22, 140, 80);
                case Tone.Attention: return Color.FromArgb(225, 150, 20);
                case Tone.Problem: return Color.FromArgb(190, 45, 45);
                default: return Color.FromArgb(170, 178, 190);
            }
        }

        static void WriteLogFile(string line)
        {
            lock (LogFileLock)
            {
                try
                {
                    Directory.CreateDirectory(Settings.DataFolder);
                    File.AppendAllText(Path.Combine(Settings.DataFolder, "nhat-ky.txt"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine, new UTF8Encoding(false));
                }
                catch (IOException)
                {
                }
            }
        }
    }
}
