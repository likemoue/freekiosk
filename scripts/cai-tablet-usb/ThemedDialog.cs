using System;
using System.Drawing;
using System.Windows.Forms;

namespace CaiTablet
{
    /// <summary>
    /// The frame of a dialog: the blue band, the page with its cards, and the buttons on a white
    /// strip. Subclasses fill <see cref="Content"/> and call <see cref="Finish"/> last.
    /// </summary>
    abstract class ThemedDialog : Form
    {
        readonly Panel band = new Panel { Dock = DockStyle.Top, Height = 70, BackColor = Theme.Brand };
        readonly Label bandTitle = Theme.BandTitle("");
        readonly Label bandSubtitle = Theme.BandSubtitle();
        readonly Panel scroller = new Panel { Dock = DockStyle.Fill, AutoScroll = true, BackColor = Theme.Page };
        readonly TableLayoutPanel footer = new TableLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 2, RowCount = 1, BackColor = Color.White, Padding = new Padding(16, 12, 14, 12), Margin = new Padding(0) };

        protected readonly TableLayoutPanel Content = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 1, BackColor = Theme.Page, Padding = new Padding(14), Margin = new Padding(0) };

        protected ThemedDialog(string windowTitle, string title, string subtitle)
        {
            SuspendLayout();
            Text = windowTitle;
            Font = Theme.Body;
            ForeColor = Theme.Ink;
            BackColor = Theme.Page;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;

            band.Controls.Add(bandTitle);
            band.Controls.Add(bandSubtitle);
            band.Resize += delegate { bandSubtitle.Width = Math.Max(100, band.ClientSize.Width - 2 * bandSubtitle.Left); };
            ShowBand(title, subtitle);

            footer.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            footer.Paint += delegate(object sender, PaintEventArgs e)
            {
                using (var pen = new Pen(Theme.Line)) e.Graphics.DrawLine(pen, 0, 0, footer.Width, 0);
            };

            scroller.Controls.Add(Content);
            Content.SizeChanged += delegate { if (IsHandleCreated) FitWindow(); };

            // Docking starts from the last one added, and the tab order from the first: fields, then buttons
            Controls.Add(scroller);
            Controls.Add(footer);
            Controls.Add(band);
        }

        protected void ShowBand(string title, string subtitle)
        {
            bandTitle.Text = title;
            bandSubtitle.Text = subtitle;
        }

        /// <summary>
        /// Puts the buttons in place and scales the window to the screen. It has to come last: scaling
        /// applies to what exists at that moment, and every size above is in pixels at 100%.
        /// </summary>
        protected void Finish(Button primary, Button cancel, string note)
        {
            if (note != null)
            {
                footer.Controls.Add(new Label { Text = note, AutoSize = true, MaximumSize = new Size(Theme.FieldWidth + 60, 0), Font = Theme.Small, ForeColor = Theme.Soft, Anchor = AnchorStyles.Left, Margin = new Padding(0, 0, 16, 0) }, 0, 0);
            }
            var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, Anchor = AnchorStyles.Right, BackColor = Color.White, Margin = new Padding(0) };
            cancel.Margin = new Padding(0);
            primary.Margin = new Padding(0, 0, 8, 0);
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(primary);
            footer.Controls.Add(buttons, 1, 0);

            AcceptButton = primary;
            CancelButton = cancel;
            cancel.DialogResult = DialogResult.Cancel;

            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            ResumeLayout(true);
        }

        protected override void OnLoad(EventArgs e)
        {
            // Before the base: that is where a dialog centers itself, on the size it has by then
            FitWindow();
            base.OnLoad(e);
        }

        /// <summary>As big as the content, unless the screen is smaller: then the fields scroll and the buttons stay in view.</summary>
        void FitWindow()
        {
            Rectangle screen = Screen.FromControl(this).WorkingArea;
            int edgesHigh = Height - ClientSize.Height;
            int edgesWide = Width - ClientSize.Width;
            int wanted = band.Height + Content.Height + footer.Height;
            int height = Math.Min(wanted, screen.Height - edgesHigh);
            int width = Content.Width + (height < wanted ? SystemInformation.VerticalScrollBarWidth : 0);
            ClientSize = new Size(Math.Min(width, screen.Width - edgesWide), height);
            if (Bottom > screen.Bottom) Top = Math.Max(screen.Top, screen.Bottom - Height);
        }
    }
}
