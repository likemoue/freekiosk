using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace CaiTablet
{
    enum UpdateOutcome { UpToDate, Updated, Skipped, Failed }

    sealed class UpdateResult
    {
        public UpdateOutcome Outcome;
        public string Message;
        public string Version;
    }

    sealed class UpdateError : Exception
    {
        public UpdateError(string message)
            : base(message)
        {
        }
    }

    /// <summary>
    /// The tool keeps itself up to date from the website, as the tablets do: each start asks for the version
    /// there, and a newer one is downloaded, checked against the key this copy was built with, and put in
    /// place of the files of this folder. Windows lets a running program be renamed but not replaced, so the
    /// old files stay next to the new ones as *.cu until the next start.
    ///
    /// The signature is what this trusts, not the website: a website taken over could otherwise hand every
    /// PC that installs tablets a program of its own.
    /// </summary>
    static class CapNhat
    {
        public const string ListName = "phien-ban.json";
        public const string SignatureName = "phien-ban.sig";
        public const string AfterUpdateArgument = "--sau-cap-nhat";
        const string OldSuffix = ".cu";
        const string NewSuffix = ".moi";
        const string Program = "CaiTablet.exe";
        const SecurityProtocolType Tls13 = (SecurityProtocolType)12288; // Named from .NET 4.8 only

        static readonly Regex SafePath = new Regex(@"^[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$");
        static readonly Regex VersionPattern = new Regex(@"^\d{4}\.\d{2}\.\d{2}\.\d{4}$");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        sealed class Item
        {
            public string Path;
            public string Target;
            public string Fresh;
            public string Old;
            public bool Placed;
        }

        /// <summary>
        /// What an update left behind: the old files once nothing runs from them any more, and the new ones
        /// of an update that failed. Only a file named after one of the tool's own, next to it, is touched:
        /// the folder may be someone's Desktop.
        /// </summary>
        public static void CleanUp(string folder)
        {
            foreach (string directory in new[] { folder, Path.Combine(folder, "adb") })
            {
                string[] files;
                try { files = Directory.GetFiles(directory); }
                catch (IOException) { continue; }
                catch (UnauthorizedAccessException) { continue; }
                foreach (string file in files)
                {
                    Match match = Regex.Match(Path.GetFileName(file), @"^(.+)\.(cu\d*|moi)$", RegexOptions.IgnoreCase);
                    if (!match.Success || !File.Exists(Path.Combine(directory, match.Groups[1].Value))) continue;
                    try { File.Delete(file); }
                    catch (IOException) { } // A program still running from it: next time
                    catch (UnauthorizedAccessException) { }
                }
            }
        }

        public static UpdateResult Run(string serverUrl, string folder, Action<string> progress, CancellationToken cancel)
        {
            if (!VersionPattern.IsMatch(PhienBan.Hien) || PhienBan.KhoaCongKhai == "")
            {
                return Result(UpdateOutcome.Skipped, "Bản này không build bằng build.ps1 nên không tự cập nhật.");
            }
            string baseUrl = (Environment.GetEnvironmentVariable("CAITABLET_UPDATE_URL") ?? serverUrl ?? "").Trim().TrimEnd('/');
            Uri parsed;
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out parsed) || (parsed.Scheme != "https" && parsed.Scheme != "http"))
            {
                return Result(UpdateOutcome.Skipped, "Chưa có địa chỉ website để kiểm tra bản mới.");
            }
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | Tls13;

            IDictionary info;
            try
            {
                info = Json.DeserializeObject(Text(baseUrl + "/api/public/usb-tool")) as IDictionary;
            }
            catch (WebException e)
            {
                var response = e.Response as HttpWebResponse;
                if (response != null && response.StatusCode == HttpStatusCode.NotFound) return Result(UpdateOutcome.UpToDate, "Website chưa có bản công cụ nào để cập nhật.");
                return Result(UpdateOutcome.Failed, "Không kiểm tra được bản mới của công cụ: " + Reason(e));
            }
            catch (ArgumentException)
            {
                return Result(UpdateOutcome.Failed, "Không kiểm tra được bản mới của công cụ: website trả về dữ liệu không đọc được.");
            }

            string version = info == null ? null : info["version"] as string;
            if (version == null || !VersionPattern.IsMatch(version)) return Result(UpdateOutcome.Failed, "Không kiểm tra được bản mới của công cụ: website trả về phiên bản không đọc được.");
            if (string.CompareOrdinal(version, PhienBan.Hien) <= 0) return Result(UpdateOutcome.UpToDate, "Công cụ đang là bản mới nhất (" + PhienBan.Hien + ").");

            string digest = (info["sha256"] as string ?? "").ToLowerInvariant();
            long size = info.Contains("size") ? Convert.ToInt64(info["size"]) : 0;
            string download = info["download"] as string ?? "/usb-tool-download";
            if (!download.StartsWith("/")) download = "/usb-tool-download";

            try
            {
                string probe = Path.Combine(folder, ".kiem-tra-ghi");
                File.WriteAllText(probe, "");
                File.Delete(probe);
            }
            catch (Exception e)
            {
                if (!(e is IOException || e is UnauthorizedAccessException)) throw;
                return Result(UpdateOutcome.Failed, "Có bản mới " + version + " nhưng không ghi được vào thư mục của công cụ (" + e.Message + "). Hãy chép cả thư mục ra Desktop rồi mở lại.");
            }

            string archive = Path.Combine(Path.GetTempPath(), "CaiTablet-USB-" + version + ".zip");
            try
            {
                Download(baseUrl + download, archive, size, version, progress, cancel);
                if (Sha256(archive) != digest) throw new UpdateError("tệp tải về không khớp mã SHA-256 website báo, có thể đã đứt giữa chừng");
                progress("Đang kiểm tra chữ ký của bản " + version);
                List<Item> items = Unpack(archive, folder, version);
                Swap(items);
                // Left by the first builds that had them in the folder: they would name an old version
                foreach (string stale in new[] { ListName, SignatureName })
                {
                    try { File.Delete(Path.Combine(folder, stale)); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
            catch (UpdateError e)
            {
                CleanUp(folder);
                return Result(UpdateOutcome.Failed, "Không cập nhật được lên bản " + version + ": " + e.Message);
            }
            catch (WebException e)
            {
                return Result(UpdateOutcome.Failed, "Không tải được bản " + version + ": " + Reason(e));
            }
            catch (OperationCanceledException)
            {
                CleanUp(folder);
                throw;
            }
            catch (Exception e)
            {
                // A broken archive (InvalidDataException), a folder that refuses a file, a key that does not load
                CleanUp(folder);
                return Result(UpdateOutcome.Failed, "Không cập nhật được lên bản " + version + ": " + e.Message);
            }
            finally
            {
                try { File.Delete(archive); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            var done = Result(UpdateOutcome.Updated, "Đã cập nhật công cụ lên bản " + version + ".");
            done.Version = version;
            return done;
        }

        static UpdateResult Result(UpdateOutcome outcome, string message)
        {
            return new UpdateResult { Outcome = outcome, Message = message };
        }

        static HttpWebRequest Request(string url, int timeout)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Timeout = timeout;
            request.ReadWriteTimeout = timeout;
            request.UserAgent = "FreeKiosk-CaiTablet/" + PhienBan.Hien;
            return request;
        }

        static string Text(string url)
        {
            HttpWebRequest request = Request(url, 15000);
            request.Accept = "application/json";
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        static void Download(string url, string file, long size, string version, Action<string> progress, CancellationToken cancel)
        {
            HttpWebRequest request = Request(url, 60000);
            using (var response = (HttpWebResponse)request.GetResponse())
            using (Stream input = response.GetResponseStream())
            using (FileStream output = File.Create(file))
            {
                var buffer = new byte[81920];
                long received = 0;
                int lastShown = -1;
                int read;
                while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    cancel.ThrowIfCancellationRequested();
                    output.Write(buffer, 0, read);
                    received += read;
                    int percent = size > 0 ? (int)(received * 100 / size) / 10 * 10 : -1;
                    if (percent != lastShown)
                    {
                        lastShown = percent;
                        progress("Đang tải bản " + version + (percent >= 0 ? ": " + percent + "% của " + (size / 1048576) + " MB" : ": " + (received / 1048576) + " MB"));
                    }
                }
            }
        }

        /// <summary>Each file next to the one it replaces, as *.moi, after the list it comes in is found signed</summary>
        static List<Item> Unpack(string archive, string folder, string version)
        {
            using (ZipArchive zip = ZipFile.OpenRead(archive))
            {
                ZipArchiveEntry listEntry = zip.GetEntry(ListName);
                ZipArchiveEntry signatureEntry = zip.GetEntry(SignatureName);
                if (listEntry == null || signatureEntry == null) throw new UpdateError("bản này thiếu danh sách tệp hoặc chữ ký");
                byte[] list = ReadSmall(listEntry);
                byte[] signature;
                try
                {
                    signature = Convert.FromBase64String(Encoding.ASCII.GetString(ReadSmall(signatureEntry)).Trim());
                }
                catch (FormatException)
                {
                    throw new UpdateError("chữ ký không đọc được");
                }
                if (!Verify(list, signature))
                {
                    throw new UpdateError("chữ ký không khớp khóa của công cụ này, nên bản đó không được cài. Nếu vừa đổi khóa ký, hãy chép công cụ mới bằng tay");
                }

                var manifest = Json.DeserializeObject(Encoding.UTF8.GetString(list).TrimStart('\uFEFF')) as IDictionary;
                if (manifest == null || manifest["version"] as string != version) throw new UpdateError("danh sách tệp không khớp phiên bản website báo");
                var files = manifest["files"] as IEnumerable;
                if (files == null) throw new UpdateError("danh sách tệp không đọc được");

                var items = new List<Item>();
                foreach (IDictionary file in files.OfType<IDictionary>())
                {
                    string path = file["path"] as string;
                    string expected = (file["sha256"] as string ?? "").ToLowerInvariant();
                    if (path == null || !SafePath.IsMatch(path) || path.Split('/').Contains("..")) throw new UpdateError("tên tệp không hợp lệ trong danh sách");
                    ZipArchiveEntry entry = zip.GetEntry(path);
                    if (entry == null) throw new UpdateError("thiếu tệp " + path);

                    string target = Path.Combine(folder, path.Replace('/', Path.DirectorySeparatorChar));
                    var item = new Item { Path = path, Target = target, Fresh = target + NewSuffix };
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    if (WriteHashed(entry, item.Fresh) != expected) throw new UpdateError(path + " không khớp mã SHA-256 trong danh sách");
                    items.Add(item);
                }
                if (!items.Any(item => item.Path == Program)) throw new UpdateError("bản này không có " + Program);
                return items;
            }
        }

        static byte[] ReadSmall(ZipArchiveEntry entry)
        {
            if (entry.Length > 1048576) throw new UpdateError(entry.FullName + " quá lớn");
            using (Stream input = entry.Open())
            using (var memory = new MemoryStream())
            {
                input.CopyTo(memory);
                return memory.ToArray();
            }
        }

        static string WriteHashed(ZipArchiveEntry entry, string file)
        {
            using (SHA256 hash = SHA256.Create())
            using (Stream input = entry.Open())
            using (FileStream output = File.Create(file))
            {
                var buffer = new byte[81920];
                int read;
                while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    hash.TransformBlock(buffer, 0, read, null, 0);
                    output.Write(buffer, 0, read);
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                return Hex(hash.Hash);
            }
        }

        public static bool Verify(byte[] data, byte[] signature)
        {
            using (var rsa = new RSACng())
            {
                rsa.FromXmlString(PhienBan.KhoaCongKhai);
                return rsa.VerifyData(data, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            }
        }

        /// <summary>All or nothing: a folder half old and half new would not run</summary>
        static void Swap(List<Item> items)
        {
            var touched = new List<Item>();
            try
            {
                foreach (Item item in items)
                {
                    touched.Add(item);
                    if (File.Exists(item.Target))
                    {
                        string old = item.Target + OldSuffix;
                        if (File.Exists(old))
                        {
                            try { File.Delete(old); }
                            catch (IOException) { old = item.Target + OldSuffix + DateTime.Now.Ticks; } // Still running from the last update
                            catch (UnauthorizedAccessException) { old = item.Target + OldSuffix + DateTime.Now.Ticks; }
                        }
                        Retry(delegate { File.Move(item.Target, old); });
                        item.Old = old;
                    }
                    Retry(delegate { File.Move(item.Fresh, item.Target); });
                    item.Placed = true;
                }
            }
            catch (Exception e)
            {
                if (!(e is IOException || e is UnauthorizedAccessException)) throw;
                foreach (Item item in Enumerable.Reverse(touched))
                {
                    try
                    {
                        if (item.Placed) File.Delete(item.Target);
                        if (item.Old != null) File.Move(item.Old, item.Target);
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
                throw new UpdateError("không thay được tệp (" + e.Message + "), công cụ giữ nguyên bản cũ");
            }
        }

        /// <summary>An antivirus may hold a file it is scanning for a moment</summary>
        static void Retry(Action action)
        {
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    action();
                    return;
                }
                catch (IOException)
                {
                    if (attempt >= 5) throw;
                    Thread.Sleep(400 * attempt);
                }
                catch (UnauthorizedAccessException)
                {
                    if (attempt >= 5) throw;
                    Thread.Sleep(400 * attempt);
                }
            }
        }

        static string Sha256(string file)
        {
            using (SHA256 hash = SHA256.Create())
            using (FileStream input = File.OpenRead(file))
            {
                return Hex(hash.ComputeHash(input));
            }
        }

        static string Hex(byte[] bytes)
        {
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }

        static string Reason(WebException e)
        {
            var response = e.Response as HttpWebResponse;
            if (response != null) return "website trả lỗi HTTP " + (int)response.StatusCode + ".";
            if (e.Status == WebExceptionStatus.SecureChannelFailure || e.Status == WebExceptionStatus.TrustFailure)
            {
                return "không bắt tay TLS được với website. Website yêu cầu TLS 1.3, chỉ có sẵn từ Windows 11: trên máy cũ hơn công cụ chạy tiếp bằng bản đang có.";
            }
            return "máy tính không có mạng hoặc website không trả lời (" + e.Message.TrimEnd('.') + "). Công cụ chạy tiếp bằng bản đang có.";
        }
    }
}
