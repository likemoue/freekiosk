namespace CaiTablet
{
    /// <summary>
    /// The version of this copy, and the key its updates must be signed with. build.ps1 compiles a file of
    /// its own in place of this one, with the time of the build and the public half of the key it signs
    /// the archive with (CapNhat.cs). A copy built some other way never updates itself.
    /// </summary>
    static class PhienBan
    {
        public const string Hien = "dev";
        public const string KhoaCongKhai = "";
    }
}
