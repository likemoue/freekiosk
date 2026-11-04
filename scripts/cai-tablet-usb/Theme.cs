using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace CaiTablet
{
    /// <summary>What the tool's windows share, so that a dialog looks like the window that opened it.</summary>
    static class Theme
    {
        public const int FieldWidth = 400;

        const int ControlHeight = 32;
        const int EmSetCueBanner = 0x1501;

        public static readonly Color Brand = Color.FromArgb(29, 98, 216);
        public static readonly Color BrandHover = Color.FromArgb(24, 84, 190);
        public static readonly Color BrandPressed = Color.FromArgb(20, 70, 160);
        public static readonly Color OnBrand = Color.FromArgb(214, 228, 255);
        public static readonly Color OnBrandLine = Color.FromArgb(150, 185, 245);
        public static readonly Color Ink = Color.FromArgb(28, 36, 48);
        public static readonly Color Soft = Color.FromArgb(95, 105, 120);
        public static readonly Color Page = Color.FromArgb(246, 247, 249);
        public static readonly Color Line = Color.FromArgb(210, 215, 223);
        public static readonly Color Problem = Color.FromArgb(180, 40, 40);
        public static readonly Color ProblemPage = Color.FromArgb(253, 238, 238);

        public static readonly Font Body = new Font("Segoe UI", 9.75f);
        public static readonly Font Small = new Font("Segoe UI", 9f);
        public static readonly Font Strong = new Font("Segoe UI Semibold", 9.75f);
        public static readonly Font CardHeading = new Font("Segoe UI Semibold", 11f);
        public static readonly Font BandHeading = new Font("Segoe UI Semibold", 14f);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, string lParam);

        // ─── The blue band on top ───────────────────────────────────────────────

        public static Label BandTitle(string text)
        {
            return new Label { Text = text, AutoSize = true, ForeColor = Color.White, Font = BandHeading, Location = new Point(20, 10) };
        }

        public static Label BandSubtitle()
        {
            return new Label { AutoSize = false, AutoEllipsis = true, Height = 22, ForeColor = OnBrand, Location = new Point(21, 41) };
        }

        public static Button BandButton(string text)
        {
            var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(96, ControlHeight), FlatStyle = FlatStyle.Flat, ForeColor = Color.White, BackColor = Brand };
            button.FlatAppearance.BorderColor = OnBrandLine;
            button.FlatAppearance.MouseOverBackColor = BrandHover;
            button.FlatAppearance.MouseDownBackColor = BrandPressed;
            return button;
        }

        // ─── Buttons ────────────────────────────────────────────────────────────

        public static Button Primary(string text)
        {
            var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(96, ControlHeight), FlatStyle = FlatStyle.Flat, ForeColor = Color.White, BackColor = Brand, Font = Strong };
            button.FlatAppearance.BorderSize = 0;
            button.FlatAppearance.MouseOverBackColor = BrandHover;
            button.FlatAppearance.MouseDownBackColor = BrandPressed;
            return button;
        }

        public static Button Secondary(string text)
        {
            var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(96, ControlHeight), FlatStyle = FlatStyle.Flat, ForeColor = Ink, BackColor = Color.White };
            button.FlatAppearance.BorderColor = Line;
            button.FlatAppearance.MouseOverBackColor = Page;
            button.FlatAppearance.MouseDownBackColor = Line;
            return button;
        }

        // ─── Cards and fields ───────────────────────────────────────────────────

        /// <summary>A white card as on the main window: what goes in stacks from the top.</summary>
        public static TableLayoutPanel Card(string heading)
        {
            var card = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(16, 12, 16, 14), Margin = new Padding(0) };
            if (heading != null) card.Controls.Add(new Label { Text = heading, AutoSize = true, Font = CardHeading, ForeColor = Ink, Margin = new Padding(0, 0, 0, 2) });
            return card;
        }

        public static Label FieldLabel(string text)
        {
            return new Label { Text = text, AutoSize = true, Font = Strong, ForeColor = Ink, Margin = new Padding(0, 10, 0, 4) };
        }

        public static Label Hint(string text)
        {
            return new Label { Text = text, AutoSize = true, MaximumSize = new Size(FieldWidth, 0), Font = Small, ForeColor = Soft, Margin = new Padding(0, 4, 0, 0) };
        }

        /// <summary>A text box drawn flat. <paramref name="cue"/> shows in it while it is empty.</summary>
        public static Panel Input(TextBox box, int width, string cue = null)
        {
            box.BorderStyle = BorderStyle.None;
            if (cue != null) box.HandleCreated += delegate { SendMessage(box.Handle, EmSetCueBanner, (IntPtr)1, cue); };
            return Frame(box, width);
        }

        /// <summary>The border of a field, which turns blue while the field has the focus.</summary>
        public static Panel Frame(Control input, int width)
        {
            var frame = new Panel { Size = new Size(width, ControlHeight), BackColor = input.BackColor, Margin = new Padding(0) };
            input.Location = new Point(9, 8);
            input.Width = width - 18;
            input.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;
            frame.Controls.Add(input);
            // A single-line box keeps the height of its font, so it is centered rather than stretched
            frame.Layout += delegate { input.Top = (frame.ClientSize.Height - input.Height) / 2; };
            frame.Click += delegate { input.Focus(); };
            input.Enter += delegate { frame.Invalidate(); };
            input.Leave += delegate { frame.Invalidate(); };
            frame.Paint += delegate(object sender, PaintEventArgs e)
            {
                bool focused = input.ContainsFocus;
                using (var pen = new Pen(focused ? Brand : Line))
                {
                    e.Graphics.DrawRectangle(pen, 0, 0, frame.Width - 1, frame.Height - 1);
                    if (focused) e.Graphics.DrawRectangle(pen, 1, 1, frame.Width - 3, frame.Height - 3);
                }
            };
            return frame;
        }

        /// <summary>A field with a button at its end, the two taking <paramref name="width"/> together.</summary>
        public static TableLayoutPanel InputWithButton(TextBox box, Button button, int width)
        {
            var row = new TableLayoutPanel { ColumnCount = 2, RowCount = 1, Size = new Size(width, ControlHeight), Margin = new Padding(0) };
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            row.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Panel frame = Input(box, width);
            frame.Dock = DockStyle.Fill;
            frame.Margin = new Padding(0, 0, 8, 0);
            button.Margin = new Padding(0);
            button.Dock = DockStyle.Fill;
            row.Controls.Add(frame, 0, 0);
            row.Controls.Add(button, 1, 0);
            return row;
        }
    }
}
