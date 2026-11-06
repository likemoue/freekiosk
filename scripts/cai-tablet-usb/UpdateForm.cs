using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace CaiTablet
{
    /// <summary>
    /// A newer tool on the website: what it is, and a button to take it now. The download shows its
    /// progress here, and the window closes with OK once the files are in place, for the tool to open
    /// again as the new version. "Để sau" keeps this one, and the main window keeps the offer.
    /// </summary>
    sealed class UpdateForm : ThemedDialog
    {
        readonly UpdateInfo info;
        readonly string folder;
        readonly Button primary = Theme.Primary("Cập nhật ngay");
        readonly Button later = Theme.Secondary("Để sau");
        readonly ProgressBar bar = new ProgressBar { Width = Theme.FieldWidth, Height = 12, Minimum = 0, Maximum = 100, Visible = false, Margin = new Padding(0, 12, 0, 0) };
        readonly Label progress = new Label { AutoSize = true, MaximumSize = new Size(Theme.FieldWidth, 0), Font = Theme.Small, ForeColor = Theme.Soft, Margin = new Padding(0, 6, 0, 0) };
        readonly Label problem = new Label { AutoSize = true, MaximumSize = new Size(Theme.FieldWidth, 0), ForeColor = Theme.Problem, Visible = false, Margin = new Padding(0, 10, 0, 0) };
        readonly CancellationTokenSource stop = new CancellationTokenSource();
        Thread worker;

        public UpdateForm(UpdateInfo info, string folder)
            : base("Cập nhật công cụ", "Có bản mới của công cụ", "Bản đang dùng: " + PhienBan.Hien)
        {
            this.info = info;
            this.folder = folder;

            var card = Theme.Card("Bản " + info.Version);
            card.Controls.Add(Line("Build lúc " + BuiltAt(info.Version) + "."));
            if (!string.IsNullOrEmpty(info.ApkVersion))
            {
                card.Controls.Add(Line("FreeKiosk đi kèm: " + info.ApkVersion + ". Tablet cài sau khi cập nhật nhận bản này."));
            }
            card.Controls.Add(Line("Tải về " + Megabytes(info.Size) + ". Công cụ kiểm tra chữ ký của bản mới, thay các tệp trong thư mục rồi tự mở lại."));
            card.Controls.Add(bar);
            card.Controls.Add(progress);
            card.Controls.Add(problem);
            Content.Controls.Add(card);

            primary.Click += delegate { Start(); };
            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                // Closed while downloading: the download stops, and the files stay as they are
                if (worker != null && worker.IsAlive) stop.Cancel();
            };
            Finish(primary, later, null);
        }

        static Label Line(string text)
        {
            return new Label { Text = text, AutoSize = true, MaximumSize = new Size(Theme.FieldWidth, 0), ForeColor = Theme.Ink, Margin = new Padding(0, 6, 0, 0) };
        }

        static string BuiltAt(string version)
        {
            // yyyy.MM.dd.HHmm
            string[] parts = version.Split('.');
            if (parts.Length != 4 || parts[3].Length != 4) return version;
            return parts[3].Substring(0, 2) + ":" + parts[3].Substring(2) + " ngày " + parts[2] + "/" + parts[1] + "/" + parts[0];
        }

        static string Megabytes(long bytes)
        {
            if (bytes <= 0) return "vài chục MB";
            return Math.Max(1, (int)Math.Round(bytes / 1048576.0)) + " MB";
        }

        void Start()
        {
            primary.Enabled = false;
            later.Enabled = false;
            problem.Visible = false;
            bar.Value = 0;
            bar.Visible = true;
            progress.Text = "Đang tải bản " + info.Version + "…";
            worker = new Thread(delegate ()
            {
                UpdateResult result;
                try
                {
                    result = CapNhat.Apply(info, folder, delegate(long received, long size) { ShowProgress(received, size); }, stop.Token);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception error)
                {
                    result = new UpdateResult { Outcome = UpdateOutcome.Failed, Message = "Không cập nhật được: " + error.Message };
                }
                Ui(delegate { Done(result); });
            }) { IsBackground = true, Name = "cap-nhat" };
            worker.Start();
        }

        void ShowProgress(long received, long size)
        {
            Ui(delegate
            {
                if (size < 0)
                {
                    bar.Value = 100;
                    progress.Text = "Đang kiểm tra chữ ký và thay tệp…";
                    return;
                }
                int percent = size > 0 ? (int)Math.Min(100, received * 100 / size) : 0;
                bar.Value = percent;
                progress.Text = "Đang tải: " + (received / 1048576) + " / " + Megabytes(size) + " (" + percent + "%)";
            });
        }

        void Done(UpdateResult result)
        {
            if (result.Outcome == UpdateOutcome.Updated)
            {
                DialogResult = DialogResult.OK;
                Close();
                return;
            }
            bar.Visible = false;
            progress.Text = "";
            problem.Text = result.Message;
            problem.Visible = true;
            primary.Text = "Thử lại";
            primary.Enabled = true;
            later.Enabled = true;
        }

        void Ui(Action action)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke(action); }
            catch (InvalidOperationException) { }
        }
    }
}
