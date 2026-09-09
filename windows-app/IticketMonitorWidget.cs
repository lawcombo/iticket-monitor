using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("iTicket Monitor Widget")]
[assembly: System.Reflection.AssemblyProduct("iTicket Monitor Widget")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace IticketMonitorWidget
{
    internal enum MonitorState { Idle, Checking, Normal, Warning, Detected, Down }

    internal sealed class MonitorTarget
    {
        public string Key;
        public string Name;
        public string Url;
        public bool Enabled;
    }

    internal sealed class CheckResult
    {
        public MonitorState State;
        public long ResponseMs;
        public int? HttpCode;
        public string Message;
        public string TargetName;
    }

    internal sealed class WidgetSettings
    {
        private static readonly string Folder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "iticket-monitor");
        private static readonly string FilePath = Path.Combine(Folder, "widget.ini");

        public int IntervalSeconds = 30;
        public int WarningMs = 3000;
        public int CriticalMs = 10000;
        public int TimeoutMs = 15000;
        public int FailureConfirmCount = 3;
        public bool ShopEnabled = true;
        public bool HealthEnabled = true;
        public bool AlwaysOnTop = true;
        public int Left = int.MinValue;
        public int Top = int.MinValue;
        public string ShopUrl = "https://iticket.nicetcm.co.kr/api-v2/extrn/ticket/shoplist";
        public string HealthUrl = "https://iticket.nicetcm.co.kr/api-v2/extrn/ticket/monitor/healthcheck";

        public static WidgetSettings Load()
        {
            WidgetSettings settings = new WidgetSettings();
            try
            {
                if (!File.Exists(FilePath)) return settings;
                foreach (string raw in File.ReadAllLines(FilePath, Encoding.UTF8))
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    int separator = line.IndexOf('=');
                    if (separator < 1) continue;
                    string key = line.Substring(0, separator).Trim();
                    string value = line.Substring(separator + 1).Trim();
                    int number;
                    bool boolean;
                    if (key == "interval" && int.TryParse(value, out number)) settings.IntervalSeconds = number;
                    else if (key == "warningMs" && int.TryParse(value, out number)) settings.WarningMs = number;
                    else if (key == "criticalMs" && int.TryParse(value, out number)) settings.CriticalMs = number;
                    else if (key == "timeoutMs" && int.TryParse(value, out number)) settings.TimeoutMs = number;
                    else if (key == "failureConfirmCount" && int.TryParse(value, out number)) settings.FailureConfirmCount = number;
                    else if (key == "shopEnabled" && bool.TryParse(value, out boolean)) settings.ShopEnabled = boolean;
                    else if (key == "healthEnabled" && bool.TryParse(value, out boolean)) settings.HealthEnabled = boolean;
                    else if (key == "alwaysOnTop" && bool.TryParse(value, out boolean)) settings.AlwaysOnTop = boolean;
                    else if (key == "left" && int.TryParse(value, out number)) settings.Left = number;
                    else if (key == "top" && int.TryParse(value, out number)) settings.Top = number;
                    else if (key == "shopUrl" && Uri.IsWellFormedUriString(value, UriKind.Absolute)) settings.ShopUrl = value;
                    else if (key == "healthUrl" && Uri.IsWellFormedUriString(value, UriKind.Absolute)) settings.HealthUrl = value;
                }
            }
            catch { }
            return settings;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Folder);
                string[] lines = {
                    "# iTicket Monitor Widget 설정",
                    "interval=" + IntervalSeconds,
                    "warningMs=" + WarningMs,
                    "criticalMs=" + CriticalMs,
                    "timeoutMs=" + TimeoutMs,
                    "failureConfirmCount=" + FailureConfirmCount,
                    "shopEnabled=" + ShopEnabled,
                    "healthEnabled=" + HealthEnabled,
                    "alwaysOnTop=" + AlwaysOnTop,
                    "left=" + Left,
                    "top=" + Top,
                    "shopUrl=" + ShopUrl,
                    "healthUrl=" + HealthUrl
                };
                File.WriteAllLines(FilePath, lines, new UTF8Encoding(false));
            }
            catch { }
        }

        public static string GetFilePath() { return FilePath; }
    }

    internal static class CredentialStore
    {
        private static readonly string Folder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "iticket-monitor");
        private static readonly string FilePath = Path.Combine(Folder, "authorization.dat");

        public static string Load()
        {
            try
            {
                if (!File.Exists(FilePath)) return "";
                byte[] encrypted = File.ReadAllBytes(FilePath);
                byte[] plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plain);
            }
            catch { return ""; }
        }

        public static void Save(string value)
        {
            Directory.CreateDirectory(Folder);
            byte[] plain = Encoding.UTF8.GetBytes(value);
            byte[] encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(FilePath, encrypted);
        }
    }

    internal sealed class TokenDialog : Form
    {
        private readonly TextBox tokenBox;
        public string AuthorizationValue { get; private set; }

        public TokenDialog(string current)
        {
            Text = "인증 토큰 설정";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = true;
            ClientSize = new Size(510, 152);
            Font = new Font("맑은 고딕", 9F);

            Label guide = new Label();
            guide.Text = "API 호출에 사용할 Bearer 토큰을 입력하세요. 이 Windows 사용자 계정에 암호화해 저장합니다.";
            guide.AutoSize = false;
            guide.Size = new Size(470, 40);
            guide.Location = new Point(18, 16);

            tokenBox = new TextBox();
            tokenBox.UseSystemPasswordChar = true;
            tokenBox.Size = new Size(470, 25);
            tokenBox.Location = new Point(18, 57);
            tokenBox.Text = current ?? "";

            Button save = new Button();
            save.Text = "저장";
            save.DialogResult = DialogResult.OK;
            save.Size = new Size(82, 31);
            save.Location = new Point(406, 104);

            Button cancel = new Button();
            cancel.Text = "취소";
            cancel.DialogResult = DialogResult.Cancel;
            cancel.Size = new Size(82, 31);
            cancel.Location = new Point(316, 104);

            Controls.Add(guide);
            Controls.Add(tokenBox);
            Controls.Add(save);
            Controls.Add(cancel);
            AcceptButton = save;
            CancelButton = cancel;

            FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (DialogResult != DialogResult.OK) return;
                string value = tokenBox.Text.Trim();
                if (value.Length == 0)
                {
                    MessageBox.Show("토큰을 입력해 주세요.", "iTicket 서버 모니터", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    e.Cancel = true;
                    return;
                }
                AuthorizationValue = value.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                    ? value
                    : "Bearer " + value;
            };
        }
    }

    internal sealed class TrafficLightControl : Control
    {
        private MonitorState state = MonitorState.Idle;

        public MonitorState State
        {
            get { return state; }
            set { state = value; Invalidate(); }
        }

        public TrafficLightControl()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint, true);
            Size = new Size(54, 112);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath housing = RoundedRectangle(new Rectangle(6, 2, 42, 106), 14))
            using (SolidBrush housingBrush = new SolidBrush(Color.FromArgb(35, 43, 55)))
            {
                e.Graphics.FillPath(housingBrush, housing);
            }

            DrawLamp(e.Graphics, new Rectangle(15, 11, 24, 24), Color.FromArgb(224, 58, 58), state == MonitorState.Down);
            DrawLamp(e.Graphics, new Rectangle(15, 44, 24, 24), Color.FromArgb(242, 151, 39), state == MonitorState.Warning || state == MonitorState.Detected);
            DrawLamp(e.Graphics, new Rectangle(15, 77, 24, 24), Color.FromArgb(34, 177, 92), state == MonitorState.Normal);

            if (state == MonitorState.Checking)
            {
                using (Pen pen = new Pen(Color.FromArgb(56, 132, 255), 3))
                    e.Graphics.DrawEllipse(pen, new Rectangle(12, 41, 30, 30));
            }
        }

        private static void DrawLamp(Graphics graphics, Rectangle rect, Color color, bool active)
        {
            Color fill = active ? color : Color.FromArgb(72, 79, 88);
            if (active)
            {
                using (SolidBrush glow = new SolidBrush(Color.FromArgb(65, color)))
                    graphics.FillEllipse(glow, Rectangle.Inflate(rect, 5, 5));
            }
            using (SolidBrush brush = new SolidBrush(fill)) graphics.FillEllipse(brush, rect);
            using (Pen pen = new Pen(Color.FromArgb(115, 255, 255, 255), 1)) graphics.DrawEllipse(pen, rect);
        }

        private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = radius * 2;
            path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    internal sealed class WidgetForm : Form
    {
        private const string DashboardUrl = "https://lawcombo.github.io/iticket-monitor/";
        private const string StartupName = "iTicketMonitorWidget";
        private const string StartupKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        private static readonly HttpClient Http = new HttpClient();
        private readonly WidgetSettings settings;
        private readonly List<MonitorTarget> targets;
        private readonly Dictionary<string, int> failureStreaks = new Dictionary<string, int>();
        private readonly System.Windows.Forms.Timer timer;
        private readonly TrafficLightControl trafficLight;
        private readonly Label stateLabel;
        private readonly Label summaryLabel;
        private readonly Label checkedLabel;
        private readonly NotifyIcon trayIcon;
        private readonly ContextMenuStrip menu;
        private bool checking;
        private bool exiting;
        private bool dragging;
        private bool moved;
        private Point mouseStart;
        private Point formStart;
        private MonitorState currentState = MonitorState.Idle;
        private DateTime nextCheckAt;
        private string authorization;

        public WidgetForm()
        {
            settings = WidgetSettings.Load();
            authorization = CredentialStore.Load();
            targets = new List<MonitorTarget> {
                new MonitorTarget { Key = "shop", Name = "관광지조회", Url = settings.ShopUrl, Enabled = settings.ShopEnabled },
                new MonitorTarget { Key = "health", Name = "헬스체크", Url = settings.HealthUrl, Enabled = settings.HealthEnabled }
            };
            failureStreaks["shop"] = 0;
            failureStreaks["health"] = 0;

            Text = "iTicket 서버 모니터";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = settings.AlwaysOnTop;
            BackColor = Color.FromArgb(247, 249, 252);
            ClientSize = new Size(310, 132);
            StartPosition = FormStartPosition.Manual;
            Font = new Font("맑은 고딕", 9F, FontStyle.Regular, GraphicsUnit.Point);
            DoubleBuffered = true;

            trafficLight = new TrafficLightControl();
            trafficLight.Location = new Point(11, 10);

            Label titleLabel = new Label();
            titleLabel.Text = "iTicket 서버 상태";
            titleLabel.Font = new Font("맑은 고딕", 10F, FontStyle.Bold);
            titleLabel.ForeColor = Color.FromArgb(39, 52, 69);
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(77, 13);

            stateLabel = new Label();
            stateLabel.Text = "점검 전";
            stateLabel.Font = new Font("맑은 고딕", 16F, FontStyle.Bold);
            stateLabel.ForeColor = Color.FromArgb(104, 118, 135);
            stateLabel.AutoSize = true;
            stateLabel.Location = new Point(75, 35);

            summaryLabel = new Label();
            summaryLabel.Text = "잠시 후 자동으로 점검합니다.";
            summaryLabel.ForeColor = Color.FromArgb(91, 106, 123);
            summaryLabel.AutoEllipsis = true;
            summaryLabel.Size = new Size(216, 21);
            summaryLabel.Location = new Point(77, 72);

            checkedLabel = new Label();
            checkedLabel.Text = "클릭: 상세 화면 · 우클릭: 설정";
            checkedLabel.ForeColor = Color.FromArgb(125, 138, 153);
            checkedLabel.Font = new Font("맑은 고딕", 8F);
            checkedLabel.AutoEllipsis = true;
            checkedLabel.Size = new Size(220, 20);
            checkedLabel.Location = new Point(77, 98);

            Controls.Add(trafficLight);
            Controls.Add(titleLabel);
            Controls.Add(stateLabel);
            Controls.Add(summaryLabel);
            Controls.Add(checkedLabel);

            menu = BuildMenu();
            ContextMenuStrip = menu;
            trayIcon = new NotifyIcon();
            trayIcon.Visible = true;
            trayIcon.Text = "iTicket 서버 상태: 점검 전";
            trayIcon.ContextMenuStrip = menu;
            trayIcon.Icon = CreateStatusIcon(Color.FromArgb(110, 120, 132));
            trayIcon.DoubleClick += delegate { OpenDashboard(); };

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 1000;
            timer.Tick += TimerTick;

            WireDrag(this);
            foreach (Control control in Controls) WireDrag(control);
            Resize += delegate { ApplyRoundedRegion(); };
            Shown += OnShown;
            FormClosing += OnFormClosing;
        }

        private ContextMenuStrip BuildMenu()
        {
            ContextMenuStrip context = new ContextMenuStrip();
            context.Font = new Font("맑은 고딕", 9F);

            ToolStripMenuItem checkNow = new ToolStripMenuItem("지금 점검");
            checkNow.Click += async delegate { await CheckNowAsync(); };
            context.Items.Add(checkNow);

            ToolStripMenuItem open = new ToolStripMenuItem("상세 모니터링 화면 열기");
            open.Click += delegate { OpenDashboard(); };
            context.Items.Add(open);
            context.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem targetsMenu = new ToolStripMenuItem("호출 서버");
            foreach (MonitorTarget target in targets)
            {
                MonitorTarget captured = target;
                ToolStripMenuItem item = new ToolStripMenuItem(target.Name);
                item.Checked = target.Enabled;
                item.CheckOnClick = true;
                item.CheckedChanged += delegate {
                    captured.Enabled = item.Checked;
                    SaveSettings();
                    nextCheckAt = DateTime.Now;
                };
                targetsMenu.DropDownItems.Add(item);
            }
            context.Items.Add(targetsMenu);

            ToolStripMenuItem intervalMenu = new ToolStripMenuItem("점검 주기");
            int[] intervals = { 5, 10, 30, 60 };
            foreach (int seconds in intervals)
            {
                int capturedSeconds = seconds;
                ToolStripMenuItem item = new ToolStripMenuItem(seconds + "초");
                item.Checked = settings.IntervalSeconds == seconds;
                item.Click += delegate {
                    settings.IntervalSeconds = capturedSeconds;
                    foreach (ToolStripMenuItem other in intervalMenu.DropDownItems) other.Checked = false;
                    item.Checked = true;
                    nextCheckAt = DateTime.Now.AddSeconds(capturedSeconds);
                    SaveSettings();
                };
                intervalMenu.DropDownItems.Add(item);
            }
            context.Items.Add(intervalMenu);

            ToolStripMenuItem topmost = new ToolStripMenuItem("항상 위에 표시");
            topmost.Checked = settings.AlwaysOnTop;
            topmost.CheckOnClick = true;
            topmost.CheckedChanged += delegate { TopMost = topmost.Checked; settings.AlwaysOnTop = topmost.Checked; SaveSettings(); };
            context.Items.Add(topmost);

            ToolStripMenuItem startup = new ToolStripMenuItem("Windows 시작 시 자동 실행");
            startup.Checked = IsStartupEnabled();
            startup.CheckOnClick = true;
            startup.CheckedChanged += delegate { SetStartup(startup.Checked); };
            context.Items.Add(startup);

            ToolStripMenuItem openSettings = new ToolStripMenuItem("설정 파일 열기");
            openSettings.Click += delegate {
                SaveSettings();
                Process.Start("notepad.exe", WidgetSettings.GetFilePath());
            };
            context.Items.Add(openSettings);

            ToolStripMenuItem tokenSettings = new ToolStripMenuItem("인증 토큰 변경");
            tokenSettings.Click += delegate { EditToken(); };
            context.Items.Add(tokenSettings);
            context.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem exit = new ToolStripMenuItem("종료");
            exit.Click += delegate { exiting = true; Close(); };
            context.Items.Add(exit);
            return context;
        }

        private void OnShown(object sender, EventArgs e)
        {
            PlaceWindow();
            ApplyRoundedRegion();
            if (String.IsNullOrWhiteSpace(authorization)) EditToken();
            timer.Start();
            nextCheckAt = DateTime.Now;
        }

        private async void TimerTick(object sender, EventArgs e)
        {
            if (!checking && DateTime.Now >= nextCheckAt) await CheckNowAsync();
        }

        private async Task CheckNowAsync()
        {
            if (checking) return;
            checking = true;
            UpdateDisplay(MonitorState.Checking, "점검 중", "등록된 API를 호출하고 있습니다.", null);

            List<Task<CheckResult>> checks = new List<Task<CheckResult>>();
            foreach (MonitorTarget target in targets)
                if (target.Enabled) checks.Add(CheckTargetAsync(target));

            if (checks.Count == 0)
            {
                UpdateDisplay(MonitorState.Idle, "호출 중지", "ON으로 설정된 서버가 없습니다.", null);
            }
            else
            {
                CheckResult[] results = await Task.WhenAll(checks.ToArray());
                MonitorState overall = MonitorState.Normal;
                long maxMs = 0;
                string summary = "";
                foreach (CheckResult result in results)
                {
                    if (result.ResponseMs > maxMs) maxMs = result.ResponseMs;
                    if (Rank(result.State) > Rank(overall)) overall = result.State;
                    if (result.State != MonitorState.Normal && summary.Length == 0)
                        summary = result.TargetName + " · " + result.Message;
                }
                if (summary.Length == 0) summary = results.Length + "개 서버 정상 · 최대 " + maxMs + "ms";
                UpdateDisplay(overall, StateText(overall), summary, DateTime.Now);

                if (overall == MonitorState.Down && currentState != MonitorState.Down)
                {
                    trayIcon.BalloonTipTitle = "iTicket 서버 장애";
                    trayIcon.BalloonTipText = summary;
                    trayIcon.BalloonTipIcon = ToolTipIcon.Error;
                    trayIcon.ShowBalloonTip(5000);
                }
                currentState = overall;
            }

            checking = false;
            nextCheckAt = DateTime.Now.AddSeconds(settings.IntervalSeconds);
        }

        private async Task<CheckResult> CheckTargetAsync(MonitorTarget target)
        {
            Stopwatch stopwatch = Stopwatch.StartNew();
            if (String.IsNullOrWhiteSpace(authorization))
                return ApplyFailureConfirmation(target, MonitorState.Down, 0, null, "인증 토큰 미설정");
            try
            {
                using (CancellationTokenSource timeout = new CancellationTokenSource(settings.TimeoutMs))
                using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, target.Url))
                {
                    request.Headers.TryAddWithoutValidation("Authorization", authorization);
                    request.Headers.TryAddWithoutValidation("Accept", "application/json");
                    request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
                    using (HttpResponseMessage response = await Http.SendAsync(request, timeout.Token))
                    {
                        string body = await response.Content.ReadAsStringAsync();
                        stopwatch.Stop();
                        string apiStatus;
                        string apiMessage;
                        ReadApiResponse(body, out apiStatus, out apiMessage);

                        MonitorState rawState;
                        string message;
                        if (!response.IsSuccessStatusCode)
                        {
                            rawState = MonitorState.Down;
                            message = "HTTP " + (int)response.StatusCode + (apiMessage.Length > 0 ? " · " + apiMessage : "");
                        }
                        else if (apiStatus == "DOWN" || apiStatus == "CRITICAL")
                        {
                            rawState = MonitorState.Down;
                            message = apiMessage.Length > 0 ? apiMessage : "API 장애 응답";
                        }
                        else if (apiStatus == "WARNING" || stopwatch.ElapsedMilliseconds >= settings.WarningMs)
                        {
                            rawState = stopwatch.ElapsedMilliseconds >= settings.CriticalMs ? MonitorState.Down : MonitorState.Warning;
                            message = rawState == MonitorState.Down ? "응답시간 장애 기준 초과" : "응답시간 지연";
                        }
                        else
                        {
                            rawState = MonitorState.Normal;
                            message = apiMessage.Length > 0 ? apiMessage : "정상";
                        }
                        return ApplyFailureConfirmation(target, rawState, stopwatch.ElapsedMilliseconds, (int)response.StatusCode, message);
                    }
                }
            }
            catch (TaskCanceledException)
            {
                stopwatch.Stop();
                return ApplyFailureConfirmation(target, MonitorState.Down, stopwatch.ElapsedMilliseconds, null, "요청시간 초과");
            }
            catch (Exception exception)
            {
                stopwatch.Stop();
                return ApplyFailureConfirmation(target, MonitorState.Down, stopwatch.ElapsedMilliseconds, null, SafeMessage(exception));
            }
        }

        private CheckResult ApplyFailureConfirmation(MonitorTarget target, MonitorState rawState, long ms, int? code, string message)
        {
            MonitorState shown = rawState;
            if (rawState == MonitorState.Down)
            {
                failureStreaks[target.Key] = failureStreaks[target.Key] + 1;
                if (failureStreaks[target.Key] < settings.FailureConfirmCount) shown = MonitorState.Detected;
            }
            else failureStreaks[target.Key] = 0;

            return new CheckResult { State = shown, ResponseMs = ms, HttpCode = code, Message = message, TargetName = target.Name };
        }

        private static void ReadApiResponse(string body, out string status, out string message)
        {
            status = "";
            message = "";
            if (String.IsNullOrWhiteSpace(body)) return;
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                Dictionary<string, object> data = serializer.DeserializeObject(body) as Dictionary<string, object>;
                if (data == null) return;
                object value;
                if (data.TryGetValue("status", out value) && value != null) status = value.ToString().ToUpperInvariant();
                if (data.TryGetValue("message", out value) && value != null) message = value.ToString();
                else if (data.TryGetValue("resultMsg", out value) && value != null) message = value.ToString();
                if (message.Length > 160) message = message.Substring(0, 160);
            }
            catch { }
        }

        private void UpdateDisplay(MonitorState state, string stateText, string summary, DateTime? checkedAt)
        {
            trafficLight.State = state;
            stateLabel.Text = stateText;
            stateLabel.ForeColor = StateColor(state);
            summaryLabel.Text = summary;
            checkedLabel.Text = checkedAt.HasValue
                ? "마지막 점검 " + checkedAt.Value.ToString("HH:mm:ss") + " · 클릭: 상세"
                : "클릭: 상세 화면 · 우클릭: 설정";
            trayIcon.Text = Truncate("iTicket 서버 상태: " + stateText, 63);
            Icon old = trayIcon.Icon;
            trayIcon.Icon = CreateStatusIcon(StateColor(state));
            if (old != null) old.Dispose();
        }

        private static int Rank(MonitorState state)
        {
            if (state == MonitorState.Down) return 5;
            if (state == MonitorState.Detected) return 4;
            if (state == MonitorState.Warning) return 3;
            if (state == MonitorState.Checking) return 2;
            if (state == MonitorState.Normal) return 1;
            return 0;
        }

        private static string StateText(MonitorState state)
        {
            if (state == MonitorState.Normal) return "정상";
            if (state == MonitorState.Warning) return "지연";
            if (state == MonitorState.Detected) return "이상 감지";
            if (state == MonitorState.Down) return "장애";
            if (state == MonitorState.Checking) return "점검 중";
            return "점검 전";
        }

        private static Color StateColor(MonitorState state)
        {
            if (state == MonitorState.Normal) return Color.FromArgb(25, 150, 77);
            if (state == MonitorState.Warning || state == MonitorState.Detected) return Color.FromArgb(211, 112, 14);
            if (state == MonitorState.Down) return Color.FromArgb(202, 48, 48);
            if (state == MonitorState.Checking) return Color.FromArgb(40, 104, 210);
            return Color.FromArgb(104, 118, 135);
        }

        private void WireDrag(Control control)
        {
            control.MouseDown += delegate(object sender, MouseEventArgs e) {
                if (e.Button != MouseButtons.Left) return;
                dragging = true;
                moved = false;
                mouseStart = Cursor.Position;
                formStart = Location;
            };
            control.MouseMove += delegate(object sender, MouseEventArgs e) {
                if (!dragging) return;
                Point now = Cursor.Position;
                int dx = now.X - mouseStart.X;
                int dy = now.Y - mouseStart.Y;
                if (Math.Abs(dx) > 3 || Math.Abs(dy) > 3) moved = true;
                Location = new Point(formStart.X + dx, formStart.Y + dy);
            };
            control.MouseUp += delegate(object sender, MouseEventArgs e) {
                if (e.Button != MouseButtons.Left || !dragging) return;
                dragging = false;
                if (moved) SaveSettings(); else OpenDashboard();
            };
        }

        private void PlaceWindow()
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            if (settings.Left != int.MinValue && settings.Top != int.MinValue)
            {
                Rectangle saved = new Rectangle(settings.Left, settings.Top, Width, Height);
                foreach (Screen screen in Screen.AllScreens)
                    if (screen.WorkingArea.IntersectsWith(saved)) { Location = saved.Location; return; }
            }
            Location = new Point(area.Right - Width - 18, area.Top + 18);
        }

        private void ApplyRoundedRegion()
        {
            using (GraphicsPath path = new GraphicsPath())
            {
                int r = 16;
                path.AddArc(0, 0, r, r, 180, 90);
                path.AddArc(Width - r, 0, r, r, 270, 90);
                path.AddArc(Width - r, Height - r, r, r, 0, 90);
                path.AddArc(0, Height - r, r, r, 90, 90);
                path.CloseFigure();
                Region = new Region(path);
            }
        }

        private void SaveSettings()
        {
            settings.Left = Left;
            settings.Top = Top;
            settings.ShopEnabled = targets[0].Enabled;
            settings.HealthEnabled = targets[1].Enabled;
            settings.ShopUrl = targets[0].Url;
            settings.HealthUrl = targets[1].Url;
            settings.Save();
        }

        private void EditToken()
        {
            using (TokenDialog dialog = new TokenDialog(authorization))
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                authorization = dialog.AuthorizationValue;
                try
                {
                    CredentialStore.Save(authorization);
                    nextCheckAt = DateTime.Now;
                }
                catch
                {
                    MessageBox.Show("인증 토큰을 저장하지 못했습니다.", "iTicket 서버 모니터", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
        }

        private static bool IsStartupEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(StartupKey))
                    return key != null && key.GetValue(StartupName) != null;
            }
            catch { return false; }
        }

        private static void SetStartup(bool enabled)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(StartupKey))
                {
                    if (enabled) key.SetValue(StartupName, "\"" + Application.ExecutablePath + "\"");
                    else key.DeleteValue(StartupName, false);
                }
            }
            catch { MessageBox.Show("자동 실행 설정을 변경하지 못했습니다.", "iTicket 서버 모니터", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }

        private static void OpenDashboard()
        {
            try { Process.Start(DashboardUrl); }
            catch { MessageBox.Show(DashboardUrl, "브라우저에서 다음 주소를 열어주세요."); }
        }

        private static string SafeMessage(Exception exception)
        {
            if (exception is HttpRequestException) return "서버 연결 실패";
            return "요청 처리 실패";
        }

        private static string Truncate(string value, int length)
        {
            return value.Length <= length ? value : value.Substring(0, length);
        }

        private static Icon CreateStatusIcon(Color color)
        {
            using (Bitmap bitmap = new Bitmap(32, 32))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.Clear(Color.Transparent);
                using (SolidBrush dark = new SolidBrush(Color.FromArgb(34, 42, 53))) graphics.FillEllipse(dark, 1, 1, 30, 30);
                using (SolidBrush brush = new SolidBrush(color)) graphics.FillEllipse(brush, 7, 7, 18, 18);
                IntPtr handle = bitmap.GetHicon();
                try { using (Icon temp = Icon.FromHandle(handle)) return (Icon)temp.Clone(); }
                finally { DestroyIcon(handle); }
            }
        }

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
        private static extern bool DestroyIcon(IntPtr handle);

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (!exiting)
            {
                e.Cancel = true;
                Hide();
                return;
            }
            timer.Stop();
            SaveSettings();
            trayIcon.Visible = false;
            trayIcon.Dispose();
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new WidgetForm());
        }
    }
}
