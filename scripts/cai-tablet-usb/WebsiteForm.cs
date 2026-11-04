using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CaiTablet
{
    /// <summary>
    /// Signs in to the website and makes an enrollment code with the chosen group and profile, so
    /// the operator can pick a profile from here. The password is used once and never saved.
    /// </summary>
    sealed class WebsiteForm : Form
    {
        const int FieldWidth = 400;

        readonly WebsiteClient client;
        readonly TextBox email = new TextBox { Width = FieldWidth };
        readonly TextBox password = new TextBox { Width = FieldWidth, UseSystemPasswordChar = true };
        readonly TextBox code = new TextBox { Width = FieldWidth };
        readonly Label codeLabel = FieldLabel("Mã xác thực 2 bước");
        readonly ComboBox group = new ComboBox { Width = FieldWidth, DropDownStyle = ComboBoxStyle.DropDownList };
        readonly ComboBox profile = new ComboBox { Width = FieldWidth, DropDownStyle = ComboBoxStyle.DropDownList };
        readonly NumericUpDown maxUses = new NumericUpDown { Width = 120, Minimum = 1, Maximum = 1000, Value = 50 };
        readonly NumericUpDown validHours = new NumericUpDown { Width = 120, Minimum = 1, Maximum = 720, Value = 720 };
        readonly Label error = new Label { AutoSize = true, MaximumSize = new Size(FieldWidth, 0), ForeColor = Color.FromArgb(180, 40, 40), Margin = new Padding(0, 10, 0, 0) };
        readonly Button primary = new Button { AutoSize = true, MinimumSize = new Size(110, 32) };
        readonly Button cancel = new Button { Text = "Hủy", AutoSize = true, MinimumSize = new Size(96, 32), DialogResult = DialogResult.Cancel };
        readonly TableLayoutPanel signIn = Page();
        readonly TableLayoutPanel choose = Page();

        bool signedIn;

        public string Token { get; private set; }
        public string Note { get; private set; }

        public WebsiteForm(string serverUrl)
        {
            client = new WebsiteClient(serverUrl);

            Text = "Lấy mã từ website";
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

            signIn.Controls.Add(Hint("Đăng nhập bằng tài khoản quản trị của website. Mật khẩu chỉ dùng cho lần này và không được lưu."));
            signIn.Controls.Add(FieldLabel("Email"));
            signIn.Controls.Add(email);
            signIn.Controls.Add(FieldLabel("Mật khẩu"));
            signIn.Controls.Add(password);
            signIn.Controls.Add(codeLabel);
            signIn.Controls.Add(code);
            codeLabel.Visible = false;
            code.Visible = false;

            choose.Controls.Add(Hint("Mọi tablet dùng mã này sẽ vào nhóm và nhận hồ sơ bạn chọn."));
            choose.Controls.Add(FieldLabel("Nhóm"));
            choose.Controls.Add(group);
            choose.Controls.Add(FieldLabel("Hồ sơ cấu hình"));
            choose.Controls.Add(profile);
            choose.Controls.Add(FieldLabel("Số máy được dùng"));
            choose.Controls.Add(maxUses);
            choose.Controls.Add(FieldLabel("Hiệu lực (giờ)"));
            choose.Controls.Add(validHours);
            choose.Visible = false;
            group.SelectedIndexChanged += delegate { DescribeGroupProfile(); };

            var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 14, 0, 0) };
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(primary);
            primary.Text = "Đăng nhập";
            primary.Click += OnPrimary;

            var layout = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill };
            layout.Controls.Add(signIn);
            layout.Controls.Add(choose);
            layout.Controls.Add(error);
            layout.Controls.Add(buttons);
            Controls.Add(layout);

            AcceptButton = primary;
            CancelButton = cancel;
            FormClosed += delegate { if (signedIn) Task.Run(() => client.Logout()); };
        }

        static TableLayoutPanel Page()
        {
            return new TableLayoutPanel { ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Margin = new Padding(0) };
        }

        static Label FieldLabel(string text)
        {
            return new Label { Text = text, AutoSize = true, Font = new Font("Segoe UI Semibold", 9.75f), Margin = new Padding(0, 10, 0, 3) };
        }

        static Label Hint(string text)
        {
            return new Label { Text = text, AutoSize = true, MaximumSize = new Size(FieldWidth, 0), ForeColor = Color.FromArgb(95, 105, 120), Margin = new Padding(0, 0, 0, 2) };
        }

        async void OnPrimary(object sender, EventArgs e)
        {
            error.Text = "";
            primary.Enabled = false;
            UseWaitCursor = true;
            try
            {
                if (signedIn) await CreateCode();
                else await SignIn();
            }
            catch (WebsiteError problem)
            {
                error.Text = problem.Message;
            }
            finally
            {
                primary.Enabled = true;
                UseWaitCursor = false;
            }
        }

        async Task SignIn()
        {
            string user = email.Text.Trim();
            string secret = password.Text;
            string twoStep = code.Text.Trim();
            if (user == "" || secret == "")
            {
                error.Text = "Hãy nhập email và mật khẩu.";
                return;
            }

            bool done = await Task.Run(() => client.Login(user, secret, twoStep));
            if (!done)
            {
                codeLabel.Visible = true;
                code.Visible = true;
                code.Focus();
                error.Text = "Tài khoản này bật xác thực 2 bước. Hãy nhập mã rồi bấm Đăng nhập.";
                return;
            }

            signedIn = true;
            password.Text = "";
            List<NamedItem> groups = await Task.Run(() => client.Groups());
            List<NamedItem> profiles = await Task.Run(() => client.Profiles());

            group.Items.Add(new NamedItem { Name = "Không có nhóm" });
            foreach (NamedItem item in groups) group.Items.Add(item);
            profile.Items.Add(new NamedItem { Name = "Không chọn" });
            foreach (NamedItem item in profiles) profile.Items.Add(item);
            group.SelectedIndex = groups.Count > 0 ? 1 : 0;
            profile.SelectedIndex = 0;

            signIn.Visible = false;
            choose.Visible = true;
            primary.Text = "Tạo mã";
        }

        /// <summary>A group's profile applies by itself: says so, so nobody picks it twice or thinks there is none.</summary>
        void DescribeGroupProfile()
        {
            var chosen = group.SelectedItem as NamedItem;
            var first = (NamedItem)profile.Items[0];
            first.Name = chosen != null && chosen.ProfileName != null ? "Theo nhóm: " + chosen.ProfileName : "Không dùng hồ sơ";
            // A ComboBox only redraws an item's text when the item is set again
            profile.Items[0] = first;
        }

        async Task CreateCode()
        {
            var chosenGroup = (NamedItem)group.SelectedItem;
            var chosenProfile = (NamedItem)profile.SelectedItem;
            int uses = (int)maxUses.Value;
            int hours = (int)validHours.Value;

            Token = await Task.Run(() => client.CreateToken("Công cụ USB " + DateTime.Now.ToString("dd/MM/yyyy"), chosenGroup.Id, chosenProfile.Id, uses, hours));

            string profileName = chosenProfile.Id != null ? chosenProfile.Name : chosenGroup.ProfileName;
            Note = profileName != null ? "hồ sơ " + profileName : "không có hồ sơ";
            DialogResult = DialogResult.OK;
        }
    }
}
