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
    sealed class WebsiteForm : ThemedDialog
    {
        readonly WebsiteClient client;
        readonly TextBox email = new TextBox();
        readonly TextBox password = new TextBox { UseSystemPasswordChar = true };
        readonly TextBox code = new TextBox();
        readonly Panel codeField;
        readonly Label codeLabel = Theme.FieldLabel("Mã xác thực 2 bước");
        readonly ComboBox group = new ComboBox { Width = Theme.FieldWidth, DropDownStyle = ComboBoxStyle.DropDownList, Margin = new Padding(0) };
        readonly ComboBox profile = new ComboBox { Width = Theme.FieldWidth, DropDownStyle = ComboBoxStyle.DropDownList, Margin = new Padding(0) };
        readonly NumericUpDown maxUses = new NumericUpDown { Minimum = 1, Maximum = 1000, Value = 50, BorderStyle = BorderStyle.None };
        readonly NumericUpDown validHours = new NumericUpDown { Minimum = 1, Maximum = 720, Value = 720, BorderStyle = BorderStyle.None };
        readonly Label error = new Label { AutoSize = true, MaximumSize = new Size(Theme.FieldWidth + 32, 0), Dock = DockStyle.Fill, ForeColor = Theme.Problem, BackColor = Theme.ProblemPage, Padding = new Padding(12, 8, 12, 8), Margin = new Padding(0, 12, 0, 0), Visible = false };
        readonly Button primary = Theme.Primary("Đăng nhập");
        readonly TableLayoutPanel signIn = Theme.Card(null);
        readonly TableLayoutPanel choose = Theme.Card(null);

        bool signedIn;

        public string Token { get; private set; }
        public string Note { get; private set; }

        public WebsiteForm(string serverUrl)
            : base("Lấy mã từ website", "Đăng nhập website", new Uri(serverUrl).Authority)
        {
            client = new WebsiteClient(serverUrl);

            codeField = Theme.Input(code, Theme.FieldWidth);
            Label intro = Theme.Hint("Đăng nhập bằng tài khoản quản trị của website. Mật khẩu chỉ dùng cho lần này và không được lưu.");
            intro.Margin = new Padding(0);
            signIn.Controls.Add(intro);
            signIn.Controls.Add(Theme.FieldLabel("Email"));
            signIn.Controls.Add(Theme.Input(email, Theme.FieldWidth));
            signIn.Controls.Add(Theme.FieldLabel("Mật khẩu"));
            signIn.Controls.Add(Theme.Input(password, Theme.FieldWidth));
            signIn.Controls.Add(codeLabel);
            signIn.Controls.Add(codeField);
            codeLabel.Visible = false;
            codeField.Visible = false;

            Label groupLabel = Theme.FieldLabel("Nhóm");
            groupLabel.Margin = new Padding(0, 0, 0, 4);
            choose.Controls.Add(groupLabel);
            choose.Controls.Add(group);
            choose.Controls.Add(Theme.FieldLabel("Hồ sơ cấu hình"));
            choose.Controls.Add(profile);
            int half = (Theme.FieldWidth - 16) / 2;
            Panel usesField = Theme.Frame(maxUses, half);
            usesField.Margin = new Padding(0, 0, 16, 0);
            var limits = new TableLayoutPanel { ColumnCount = 2, RowCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Margin = new Padding(0) };
            limits.Controls.Add(Theme.FieldLabel("Số máy được dùng"), 0, 0);
            limits.Controls.Add(Theme.FieldLabel("Hiệu lực (giờ)"), 1, 0);
            limits.Controls.Add(usesField, 0, 1);
            limits.Controls.Add(Theme.Frame(validHours, half), 1, 1);
            choose.Controls.Add(limits);
            choose.Visible = false;
            group.SelectedIndexChanged += delegate { DescribeGroupProfile(); };

            Content.Controls.Add(signIn);
            Content.Controls.Add(choose);
            Content.Controls.Add(error);

            primary.Click += OnPrimary;
            FormClosed += delegate { if (signedIn) Task.Run(() => client.Logout()); };
            Finish(primary, Theme.Secondary("Hủy"), null);
        }

        void ShowError(string message)
        {
            error.Text = message;
            error.Visible = message != "";
        }

        async void OnPrimary(object sender, EventArgs e)
        {
            ShowError("");
            primary.Enabled = false;
            UseWaitCursor = true;
            try
            {
                if (signedIn) await CreateCode();
                else await SignIn();
            }
            catch (WebsiteError problem)
            {
                ShowError(problem.Message);
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
                ShowError("Hãy nhập email và mật khẩu.");
                return;
            }

            bool done = await Task.Run(() => client.Login(user, secret, twoStep));
            if (!done)
            {
                codeLabel.Visible = true;
                codeField.Visible = true;
                code.Focus();
                ShowError("Tài khoản này bật xác thực 2 bước. Hãy nhập mã rồi bấm Đăng nhập.");
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
            ShowBand("Tạo mã đăng ký", "Mọi tablet dùng mã này sẽ vào nhóm và nhận hồ sơ bạn chọn.");
            group.Focus();
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
