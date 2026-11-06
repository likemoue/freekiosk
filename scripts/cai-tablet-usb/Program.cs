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
        static void Main(string[] args)
        {
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Opened again by the copy it replaced, which may still be closing
            string updatedFrom = null;
            int position = Array.IndexOf(args, CapNhat.AfterUpdateArgument);
            if (position >= 0) updatedFrom = position + 1 < args.Length ? args[position + 1] : "";

            // Two windows would fight over the same tablet
            using (var mutex = new Mutex(false, "FreeKioskCaiTablet"))
            {
                bool mine;
                try
                {
                    mine = mutex.WaitOne(updatedFrom != null ? 20000 : 0);
                }
                catch (AbandonedMutexException)
                {
                    // A window that closed without letting go: it is ours now
                    mine = true;
                }
                if (!mine)
                {
                    MessageBox.Show("Công cụ đang mở ở một cửa sổ khác.", "Cài tablet FreeKiosk", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                try
                {
                    Application.Run(new MainForm(updatedFrom));
                }
                finally
                {
                    mutex.ReleaseMutex();
                }
            }
        }
    }
}
