using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Cài tablet FreeKiosk qua USB")]
[assembly: AssemblyProduct("FreeKiosk")]

namespace CaiTablet
{
    static class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main()
        {
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Two windows would fight over the same tablet
            bool first;
            using (new Mutex(true, "FreeKioskCaiTablet", out first))
            {
                if (!first)
                {
                    MessageBox.Show("Công cụ đang mở ở một cửa sổ khác.", "Cài tablet FreeKiosk", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.Run(new MainForm());
            }
        }
    }
}
