using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Threading.Tasks;

namespace CaiTablet
{
    sealed class CommandResult
    {
        public int ExitCode;
        public string Output = "";
        public bool TimedOut;
    }

    sealed class AdbDevice
    {
        public string Serial;
        public string State;
    }

    /// <summary>Runs the adb that ships in the tool's folder.</summary>
    sealed class Adb
    {
        readonly string exe;

        public Adb(string exe)
        {
            this.exe = exe;
        }

        public CommandResult Run(string arguments, int timeoutMs)
        {
            var start = new ProcessStartInfo(exe, arguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            using (Process process = Process.Start(start))
            {
                Task<string> stdout = process.StandardOutput.ReadToEndAsync();
                Task<string> stderr = process.StandardError.ReadToEndAsync();
                bool exited = process.WaitForExit(timeoutMs);
                if (!exited)
                {
                    try { process.Kill(); }
                    catch (InvalidOperationException) { }
                    catch (Win32Exception) { }
                }
                // Bounded, because the adb server this call may have started inherits both
                // pipes and keeps them open for as long as it runs
                Task.WaitAll(new Task[] { stdout, stderr }, 2000);
                return new CommandResult
                {
                    TimedOut = !exited,
                    ExitCode = exited ? process.ExitCode : -1,
                    Output = (stdout.IsCompleted ? stdout.Result : "") + (stderr.IsCompleted ? stderr.Result : ""),
                };
            }
        }

        public CommandResult Shell(string serial, string command, int timeoutMs)
        {
            return Run("-s " + WinQuote(serial) + " shell " + WinQuote(command), timeoutMs);
        }

        public CommandResult Install(string serial, string apkPath, int timeoutMs)
        {
            return Run("-s " + WinQuote(serial) + " install -r -g " + WinQuote(apkPath), timeoutMs);
        }

        public CommandResult Push(string serial, string localPath, string remotePath, int timeoutMs)
        {
            return Run("-s " + WinQuote(serial) + " push " + WinQuote(localPath) + " " + WinQuote(remotePath), timeoutMs);
        }

        public List<AdbDevice> Devices()
        {
            var devices = new List<AdbDevice>();
            bool inList = false;
            foreach (string raw in Run("devices", 15000).Output.Split('\n'))
            {
                string line = raw.Trim();
                if (line.StartsWith("List of devices", StringComparison.Ordinal))
                {
                    inList = true;
                    continue;
                }
                if (!inList || line.Length == 0 || line.StartsWith("*", StringComparison.Ordinal)) continue;
                string[] parts = line.Split(new[] { '\t', ' ' }, 2, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 2) devices.Add(new AdbDevice { Serial = parts[0], State = parts[1].Trim() });
            }
            return devices;
        }

        /// <summary>Quotes a value for the shell on the tablet.</summary>
        public static string RemoteQuote(string value)
        {
            return "'" + value.Replace("'", "'\\''") + "'";
        }

        /// <summary>Quotes one argument the way the Windows command line parser expects.</summary>
        static string WinQuote(string argument)
        {
            var quoted = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char c in argument)
            {
                if (c == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (c == '"')
                {
                    quoted.Append('\\', backslashes * 2 + 1);
                }
                else
                {
                    quoted.Append('\\', backslashes);
                }
                quoted.Append(c);
                backslashes = 0;
            }
            quoted.Append('\\', backslashes * 2);
            return quoted.Append('"').ToString();
        }
    }
}
