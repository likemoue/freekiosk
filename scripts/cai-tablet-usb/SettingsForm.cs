using System;
using System.Collections;
using System.Drawing;
using System.IO;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace CaiTablet
{
    /// <summary>The one screen an operator fills in, once.</summary>
    sealed class SettingsForm : Form
    {
        const int ColumnWidth = 400;

        readonly TextBox server = new TextBox();
        readonly TextBox token = new TextBox();
        readonly Label tokenNote = Hint("");
        readonly TextBox pin = new TextBox();
        readonly TextBox wifiName = new TextBox();
        readonly TextBox wifiPassword = new TextBox { UseSystemPasswordChar = true };
        readonly CheckBox showPassword = new CheckBox { AutoSize = true, Text = "Hiện mật khẩu" };
        readonly TextBox backup = new TextBox { ReadOnly = true, Width = ColumnWidth };
        readonly CheckBox usbOff = new CheckBox { AutoSize = true, Text = "Tắt Gỡ lỗi USB khi cài xong (nên bật)" };

        string note;
        string noteForToken;

        public Settings Result { get; private set; }

        public SettingsForm(Settings current)
        {
            Text = "Thiết lập";
            Font = new Font("Segoe UI", 9.75f);
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96f, 96f);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Padding = new Padding(20, 14, 20, 14);

            server.Text = current.ServerUrl;
            token.Text = current.Token;
            pin.Text = current.Pin;
            wifiName.Text = current.WifiName;
            wifiPassword.Text = current.WifiPassword;
            backup.Text = current.BackupPath;
            usbOff.Checked = current.TurnOffUsbDebugging;
            note = current.TokenNote;
            noteForToken = current.Token;
            ShowNote();
            // A code pasted over the one the note is about makes the note wrong
            token.TextChanged += delegate { ShowNote(); };

            var left = Column();
            Field(left, "Địa chỉ website", server, null);
            Field(left, "Mã đăng ký", token, "Bấm Lấy từ website để chọn nhóm và hồ sơ ngay tại đây. Hoặc tạo mã trên website (Thêm thiết bị, Tiêu chuẩn), rồi dán mã hoặc cả dòng lệnh ADB vào ô này.");
            left.Controls.Add(tokenNote);
            var fromWebsite = new Button { Text = "Lấy từ website…", AutoSize = true, MinimumSize = new Size(140, 30), Margin = new Padding(0, 4, 0, 2) };
            fromWebsite.Click += OnFromWebsite;
            left.Controls.Add(fromWebsite);
            Field(left, "PIN trên tablet", pin, "4 đến 6 chữ số, dùng để vào Cài đặt của FreeKiosk trên tablet.");

            var right = Column();
            Field(right, "Tên Wi-Fi cho tablet", wifiName, "Nên nhập để công cụ tự nối mạng cho tablet, khỏi phải nối tay trên từng máy.");
            Field(right, "Mật khẩu Wi-Fi", wifiPassword, null);
            showPassword.Margin = new Padding(0, 2, 0, 0);
            showPassword.CheckedChanged += delegate { wifiPassword.UseSystemPasswordChar = !showPassword.Checked; };
            right.Controls.Add(showPassword);
            Field(right, "Tệp cấu hình (không bắt buộc)", backup, "Tệp xuất từ Cài đặt, Nâng cao, Sao lưu và khôi phục trên một tablet đã làm sẵn. Tệp được áp sau khi đăng ký, nên nếu có cả hồ sơ thì các mục trong tệp được ưu tiên.");
            var pick = new Button { Text = "Chọn tệp…", AutoSize = true, MinimumSize = new Size(96, 30), Margin = new Padding(0, 4, 8, 2) };
            var clear = new Button { Text = "Bỏ chọn", AutoSize = true, MinimumSize = new Size(96, 30), Margin = new Padding(0, 4, 0, 2) };
            pick.Click += OnPickBackup;
            clear.Click += delegate { backup.Text = ""; };
            var backupButtons = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0) };
            backupButtons.Controls.Add(pick);
            backupButtons.Controls.Add(clear);
            right.Controls.Add(backupButtons);
            usbOff.Margin = new Padding(0, 12, 0, 2);
            right.Controls.Add(usbOff);
            right.Controls.Add(Hint("Để không ai cắm cáp vào kiosk được."));

            var columns = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Margin = new Padding(0) };
            left.Margin = new Padding(0, 0, 24, 0);
            right.Margin = new Padding(0);
            columns.Controls.Add(left, 0, 0);
            columns.Controls.Add(right, 1, 0);

            var save = new Button { Text = "Lưu", AutoSize = true, MinimumSize = new Size(96, 32), DialogResult = DialogResult.None };
            var cancel = new Button { Text = "Hủy", AutoSize = true, MinimumSize = new Size(96, 32), DialogResult = DialogResult.Cancel };
            save.Click += OnSave;
            var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 12, 0, 0) };
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(save);

            var layout = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill };
            layout.Controls.Add(columns);
            layout.Controls.Add(Hint2("Mã đăng ký, PIN và mật khẩu Wi-Fi được mã hóa theo tài khoản Windows này, và không nằm trong thư mục công cụ."));
            layout.Controls.Add(buttons);

            Controls.Add(layout);
            AcceptButton = save;
            CancelButton = cancel;
        }

        static TableLayoutPanel Column()
        {
            return new TableLayoutPanel { ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink };
        }

        static void Field(TableLayoutPanel column, string label, Control input, string hint)
        {
            column.Controls.Add(new Label { Text = label, AutoSize = true, Font = new Font("Segoe UI Semibold", 9.75f), Margin = new Padding(0, 10, 0, 3) });
            input.Width = ColumnWidth;
            input.Margin = new Padding(0, 0, 0, 2);
            column.Controls.Add(input);
            if (hint != null) column.Controls.Add(Hint(hint));
        }

        static Label Hint(string text)
        {
            return new Label { Text = text, AutoSize = true, MaximumSize = new Size(ColumnWidth, 0), ForeColor = Color.FromArgb(95, 105, 120), Margin = new Padding(0, 0, 0, 2) };
        }

        static Label Hint2(string text)
        {
            return new Label { Text = text, AutoSize = true, ForeColor = Color.FromArgb(95, 105, 120), Margin = new Padding(0, 10, 0, 0) };
        }

        void ShowNote()
        {
            bool applies = !string.IsNullOrEmpty(note) && token.Text.Trim() == noteForToken;
            tokenNote.Visible = applies;
            tokenNote.Text = applies ? "Mã này dùng " + note + "." : "";
        }

        void OnFromWebsite(object sender, EventArgs e)
        {
            string url = CleanUrl();
            if (url == null)
            {
                Refuse("Địa chỉ website chưa đúng, ví dụ https://mdm.ism.io.vn", server);
                return;
            }
            using (var form = new WebsiteForm(url))
            {
                if (form.ShowDialog(this) != DialogResult.OK) return;
                note = form.Note;
                noteForToken = form.Token;
                token.Text = form.Token;
                ShowNote();
            }
        }

        void OnPickBackup(object sender, EventArgs e)
        {
            using (var dialog = new OpenFileDialog { Title = "Chọn tệp cấu hình", Filter = "Tệp sao lưu FreeKiosk (*.json)|*.json|Mọi tệp (*.*)|*.*" })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                string problem = CheckBackup(dialog.FileName);
                if (problem != null)
                {
                    Refuse(problem, backup);
                    return;
                }
                backup.Text = dialog.FileName;
            }
        }

        /// <summary>The checks BackupService.ts applies on the tablet: better refused here than halfway through an install.</summary>
        static string CheckBackup(string path)
        {
            try
            {
                var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
                var data = serializer.DeserializeObject(File.ReadAllText(path)) as IDictionary;
                if (data == null || !data.Contains("version") || !(data["settings"] is IDictionary))
                {
                    return "Đây không phải tệp sao lưu của FreeKiosk. Hãy dùng tệp xuất từ Cài đặt, Nâng cao, Sao lưu và khôi phục.";
                }
                return null;
            }
            catch (ArgumentException)
            {
                return "Tệp này không phải JSON hợp lệ.";
            }
            catch (IOException e)
            {
                return "Không đọc được tệp: " + e.Message;
            }
            catch (UnauthorizedAccessException e)
            {
                return "Không đọc được tệp: " + e.Message;
            }
        }

        string CleanUrl()
        {
            string url = server.Text.Trim().TrimEnd('/');
            Uri parsed;
            if (!Uri.TryCreate(url, UriKind.Absolute, out parsed) || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || Regex.IsMatch(url, @"[\s'""]")) return null;
            return url;
        }

        void OnSave(object sender, EventArgs e)
        {
            string url = CleanUrl();
            if (url == null)
            {
                Refuse("Địa chỉ website chưa đúng, ví dụ https://mdm.ism.io.vn", server);
                return;
            }

            // The website shows the code on its own and inside the ADB command: either can be pasted
            string code = token.Text.Trim();
            Match inCommand = Regex.Match(code, @"cloud_token\s+[""']?([A-Za-z0-9_-]+)");
            if (inCommand.Success) code = inCommand.Groups[1].Value;
            code = code.ToUpperInvariant();
            if (!Regex.IsMatch(code, @"^[A-Z0-9_-]{6,64}$"))
            {
                Refuse("Mã đăng ký chưa đúng. Mã trên website gồm 8 ký tự.", token);
                return;
            }

            string newPin = pin.Text.Trim();
            if (!Regex.IsMatch(newPin, @"^\d{4,6}$"))
            {
                Refuse("PIN phải gồm 4 đến 6 chữ số.", pin);
                return;
            }
            if (newPin == "1234" && MessageBox.Show(this, "1234 là PIN mặc định, ai cũng đoán được. Vẫn dùng?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
            {
                pin.Focus();
                return;
            }

            string ssid = wifiName.Text.Trim();
            string passphrase = wifiPassword.Text;
            if (ssid == "" && passphrase != "")
            {
                Refuse("Có mật khẩu Wi-Fi thì phải có cả tên Wi-Fi.", wifiName);
                return;
            }
            if (passphrase != "" && (passphrase.Length < 8 || passphrase.Length > 63))
            {
                Refuse("Mật khẩu Wi-Fi phải dài từ 8 đến 63 ký tự. Mạng không có mật khẩu thì để trống ô này.", wifiPassword);
                return;
            }

            if (backup.Text != "")
            {
                string problem = CheckBackup(backup.Text);
                if (problem != null)
                {
                    Refuse(problem, backup);
                    return;
                }
            }

            Result = new Settings
            {
                ServerUrl = url,
                Token = code,
                TokenNote = code == noteForToken ? note : "",
                Pin = newPin,
                WifiName = ssid,
                WifiPassword = passphrase,
                BackupPath = backup.Text,
                TurnOffUsbDebugging = usbOff.Checked,
            };
            Result.Save();
            DialogResult = DialogResult.OK;
        }

        void Refuse(string message, Control field)
        {
            MessageBox.Show(this, message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            field.Focus();
        }
    }
}
