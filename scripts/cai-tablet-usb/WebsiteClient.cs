using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

namespace CaiTablet
{
    sealed class WebsiteError : Exception
    {
        public WebsiteError(string message)
            : base(message)
        {
        }
    }

    sealed class NamedItem
    {
        public string Id;
        public string Name;
        public string ProfileName; // The profile of a group, if it has one

        public override string ToString()
        {
            return Name;
        }
    }

    /// <summary>
    /// The website's admin API, for the one thing the tool needs it for: making an enrollment code
    /// with a chosen group and profile. The session only lives in memory, and nothing the operator
    /// types here is saved.
    /// </summary>
    sealed class WebsiteClient
    {
        const SecurityProtocolType Tls13 = (SecurityProtocolType)12288; // Named from .NET 4.8 only

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        readonly string baseUrl;
        string sessionCookie = "";

        static WebsiteClient()
        {
            // The website's Cloudflare zone accepts nothing older than TLS 1.3
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | Tls13;
        }

        public WebsiteClient(string baseUrl)
        {
            this.baseUrl = baseUrl.TrimEnd('/');
        }

        /// <returns>False when the account needs its two-step code: call again with it.</returns>
        public bool Login(string email, string password, string code)
        {
            var body = new Dictionary<string, object> { { "email", email }, { "password", password } };
            if (code != "") body["code"] = code;
            var answer = Request("POST", "/api/admin/auth/login", body) as IDictionary;
            return !(answer != null && answer.Contains("requires2fa"));
        }

        public void Logout()
        {
            try
            {
                Request("POST", "/api/admin/auth/logout", new Dictionary<string, object>());
            }
            catch (WebsiteError)
            {
                // The session expires by itself
            }
        }

        public List<NamedItem> Groups()
        {
            return List("/api/admin/groups");
        }

        public List<NamedItem> Profiles()
        {
            return List("/api/admin/profiles");
        }

        public string CreateToken(string label, string groupId, string profileId, int maxUses, int validHours)
        {
            var body = new Dictionary<string, object> { { "label", label }, { "maxUses", maxUses }, { "validHours", validHours } };
            if (groupId != null) body["groupId"] = groupId;
            if (profileId != null) body["profileId"] = profileId;
            var answer = Request("POST", "/api/admin/enrollment/tokens", body) as IDictionary;
            string token = answer == null ? null : answer["token"] as string;
            if (string.IsNullOrEmpty(token)) throw new WebsiteError("Website không trả về mã đăng ký.");
            return token;
        }

        List<NamedItem> List(string path)
        {
            var rows = Request("GET", path, null) as IEnumerable;
            if (rows == null) throw new WebsiteError("Website trả về dữ liệu không đọc được.");
            return rows.OfType<IDictionary>().Select(row =>
            {
                var profile = row.Contains("profile") ? row["profile"] as IDictionary : null;
                return new NamedItem { Id = row["id"] as string, Name = row["name"] as string, ProfileName = profile == null ? null : profile["name"] as string };
            }).ToList();
        }

        object Request(string method, string path, object body)
        {
            var request = (HttpWebRequest)WebRequest.Create(baseUrl + path);
            request.Method = method;
            request.Timeout = 20000;
            request.ReadWriteTimeout = 20000;
            request.UserAgent = "FreeKiosk-CaiTablet";
            request.Accept = "application/json";
            request.Headers["X-Requested-With"] = "freekiosk-manager";
            if (sessionCookie != "") request.Headers[HttpRequestHeader.Cookie] = sessionCookie;
            try
            {
                if (body != null)
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(body));
                    request.ContentType = "application/json";
                    request.ContentLength = bytes.Length;
                    using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
                }
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    string cookie = response.Headers[HttpResponseHeader.SetCookie];
                    if (!string.IsNullOrEmpty(cookie)) sessionCookie = cookie.Split(';')[0];
                    string text = ReadAll(response);
                    return text == "" ? null : Json.DeserializeObject(text);
                }
            }
            catch (WebException e)
            {
                var response = e.Response as HttpWebResponse;
                if (response == null)
                {
                    throw new WebsiteError(
                        "Không kết nối được tới website: " + e.Message + " Website yêu cầu TLS 1.3, chỉ có sẵn từ Windows 11. " +
                        "Trên máy cũ hơn, hãy tạo mã trên website rồi dán vào ô Mã đăng ký.");
                }
                using (response) throw new WebsiteError(Explain(response));
            }
        }

        static string Explain(HttpWebResponse response)
        {
            if (!string.IsNullOrEmpty(response.Headers["cf-mitigated"]))
            {
                return "Cloudflare đã chặn yêu cầu này trước khi tới máy chủ. Nếu vừa nhập mật khẩu, có thể mật khẩu đó nằm trong danh sách đã bị lộ.";
            }
            string fallback = "Website trả lỗi HTTP " + (int)response.StatusCode + ".";
            try
            {
                var answer = Json.DeserializeObject(ReadAll(response)) as IDictionary;
                if (answer == null) return fallback;
                object said = answer.Contains("message") ? answer["message"] : answer.Contains("error") ? answer["error"] : null;
                var several = said as IEnumerable;
                if (said is string) return (string)said;
                if (several != null) return string.Join(". ", several.OfType<string>());
            }
            catch (ArgumentException)
            {
                // Not JSON: a proxy's error page
            }
            return fallback;
        }

        static string ReadAll(HttpWebResponse response)
        {
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) return reader.ReadToEnd();
        }
    }
}
