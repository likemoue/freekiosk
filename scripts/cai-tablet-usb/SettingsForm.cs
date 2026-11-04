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
    sealed class SettingsForm : ThemedDialog
    {
        readonly TextBox server = new TextBox();
        readonly TextBox token = new TextBox();
        readonly Label tokenNote = Theme.Hint("");
        readonly TextBox pin = new TextBox();
        readonly TextBox wifiName = new TextBox();
        readonly TextBox wifiPassword = new TextBox { UseSystemPasswordChar = true };
        readonly CheckBox showPassword = new CheckBox { AutoSize = true, Text = "Hiện mật khẩu" };
        // A read-only box goes grey by itself: this grey is the page's, so that it matches its frame
        readonly TextBox backup = new TextBox { ReadOnly = true, BackColor = Theme.Page };
        readonly CheckBox usbOff = new CheckBox { AutoSize = true, Text = "Tắt Gỡ lỗi USB khi cài xong (nên bật)" };

        string backupPath;
        string note;
        string noteForToken;

        public Settings Result { get; private set; }

        public SettingsForm(Settings current)
            : base("Thiết lập", "Thiết lập", "Chỉ cần nhập một lần, công cụ nhớ cho các lần mở sau.")
        {
            server.Text = current.ServerUrl;
            token.Text = current.Token;
            pin.Text = current.Pin;
            wifiName.Text = current.WifiName;
            wifiPassword.Text = current.WifiPassword;
            ShowBackup(current.BackupPath);
            usbOff.Checked = current.TurnOffUsbDebugging;
            note = current.TokenNote;
            noteForToken = current.Token;
            ShowNote();
            // A code pasted over the one the note is about makes the note wrong
            token.TextChanged += delegate { ShowNote(); };

            var fromWebsite = Theme.Secondary("Lấy từ website…");
            fromWebsite.ForeColor = Theme.Brand;
            fromWebsite.FlatAppearance.BorderColor = Theme.OnBrandLine;
            fromWebsite.Click += OnFromWebsite;
            tokenNote.ForeColor = Theme.Brand;

            TableLayoutPanel website = Theme.Card("Website");
            website.Controls.Add(Theme.FieldLabel("Địa chỉ website"));
            website.Controls.Add(Theme.Input(server, Theme.FieldWidth));
            website.Controls.Add(Theme.FieldLabel("Mã đăng ký"));
            website.Controls.Add(Theme.InputWithButton(token, fromWebsite, Theme.FieldWidth));
            website.Controls.Add(Theme.Hint("Bấm Lấy từ website để chọn nhóm và hồ sơ ngay tại đây. Hoặc tạo mã trên website (Thêm thiết bị, Tiêu chuẩn), rồi dán mã hoặc cả dòng lệnh ADB vào ô này."));
            website.Controls.Add(tokenNote);

            TableLayoutPanel tablet = Theme.Card("Trên tablet");
            tablet.Controls.Add(Theme.FieldLabel("PIN trên tablet"));
            tablet.Controls.Add(Theme.Input(pin, Theme.FieldWidth));
            tablet.Controls.Add(Theme.Hint("4 đến 6 chữ số, dùng để vào Cài đặt của FreeKiosk trên tablet."));
            usbOff.Margin = new Padding(0, 12, 0, 0);
            tablet.Controls.Add(usbOff);
            tablet.Controls.Add(Theme.Hint("Để không ai cắm cáp vào kiosk được."));

            TableLayoutPanel wifi = Theme.Card("Wi-Fi");
            wifi.Controls.Add(Theme.FieldLabel("Tên Wi-Fi cho tablet"));
            wifi.Controls.Add(Theme.Input(wifiName, Theme.FieldWidth));
            wifi.Controls.Add(Theme.Hint("Nên nhập để công cụ tự nối mạng cho tablet, khỏi phải nối tay trên từng máy."));
            wifi.Controls.Add(Theme.FieldLabel("Mật khẩu Wi-Fi"));
            wifi.Controls.Add(Theme.Input(wifiPassword, Theme.FieldWidth, "Để trống nếu mạng không có mật khẩu"));
            showPassword.Margin = new Padding(0, 6, 0, 0);
            showPassword.CheckedChanged += delegate { wifiPassword.UseSystemPasswordChar = !showPassword.Checked; };
            wifi.Controls.Add(showPassword);

            var pick = Theme.Secondary("Chọn tệp…");
            var clear = Theme.Secondary("Bỏ chọn");
            pick.Click += OnPickBackup;
            clear.Click += delegate { ShowBackup(""); };
            pick.Margin = new Padding(0, 8, 8, 0);
            clear.Margin = new Padding(0, 8, 0, 0);
            var backupButtons = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Margin = new Padding(0) };
            backupButtons.Controls.Add(pick);
            backupButtons.Controls.Add(clear);
            Panel backupFrame = Theme.Input(backup, Theme.FieldWidth);
            backupFrame.Margin = new Padding(0, 10, 0, 0);

            TableLayoutPanel config = Theme.Card("Tệp cấu hình (không bắt buộc)");
            config.Controls.Add(backupFrame);
            config.Controls.Add(backupButtons);
            config.Controls.Add(Theme.Hint("Tệp xuất từ Cài đặt, Nâng cao, Sao lưu và khôi phục trên một tablet đã làm sẵn. Tệp được áp sau khi đăng ký, nên nếu có cả hồ sơ thì các mục trong tệp được ưu tiên."));

            // Column by column, which is also the order Tab goes through the fields
            var grid = new TableLayoutPanel { ColumnCount = 2, RowCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Margin = new Padding(0) };
            website.Margin = new Padding(0, 0, 6, 6);
            tablet.Margin = new Padding(0, 6, 6, 0);
            wifi.Margin = new Padding(6, 0, 0, 6);
            config.Margin = new Padding(6, 6, 0, 0);
            grid.Controls.Add(website, 0, 0);
            grid.Controls.Add(tablet, 0, 1);
            grid.Controls.Add(wifi, 1, 0);
            grid.Controls.Add(config, 1, 1);
            Content.Controls.Add(grid);

            var save = Theme.Primary("Lưu");
            save.Click += OnSave;
            Finish(save, Theme.Secondary("Hủy"), "Mã đăng ký, PIN và mật khẩu Wi-Fi được mã hóa theo tài khoản Windows này, và không nằm trong thư mục công cụ.");
        }

        /// <summary>A read-only box shows no cue, so when empty it says so in the text itself.</summary>
        void ShowBackup(string path)
        {
            backupPath = path;
            backup.Text = path != "" ? path : "Chưa chọn tệp";
            backup.ForeColor = path != "" ? Theme.Ink : Theme.Soft;
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
                ShowBackup(dialog.FileName);
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

            if (backupPath != "")
            {
                string problem = CheckBackup(backupPath);
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
                BackupPath = backupPath,
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
