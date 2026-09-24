import json
import os
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
LOCAL_YTDLP = ROOT / ".venv" / ("Scripts" if os.name == "nt" else "bin") / ("yt-dlp.exe" if os.name == "nt" else "yt-dlp")
YTDLP = Path(os.environ.get("YTDLP_PATH", str(LOCAL_YTDLP)))
if not YTDLP.is_file():
    YTDLP = Path(shutil.which("yt-dlp") or "yt-dlp")
PUBLIC_ROOT = (ROOT / "public").resolve()
MAX_REQUEST_BODY = 1_000_000


def valid_url(value):
    try:
        host = urlparse(normalize_url(value)).hostname or ""
        return host in {"youtube.com", "www.youtube.com", "youtu.be", "music.youtube.com"}
    except ValueError:
        return False


def normalize_url(value):
    if not isinstance(value, str):
        return ""
    return value if value.startswith(("http://", "https://")) else f"https://{value}"


def ffmpeg_path():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def run_ytdlp(args):
    command = [str(YTDLP), "--no-warnings", "--extractor-args", "youtube:player_client=android"]
    binary = ffmpeg_path()
    if binary:
        command += ["--ffmpeg-location", binary]
    return subprocess.run(command + args, capture_output=True, text=True, check=True)


def stop_process_tree(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        process.kill()


def format_size(size):
    if not size:
        return "размер неизвестен"
    if size >= 1024 ** 3:
        return f"{size / 1024 ** 3:.1f} ГБ"
    return f"{max(1, round(size / 1024 ** 2))} МБ"


def estimate_sizes(info):
    duration = info.get("duration") or 0
    formats = info.get("formats", [])
    audio_bitrate = max((item.get("abr") or 0 for item in formats if item.get("acodec") not in (None, "none")), default=128)
    sizes = {}
    size_bytes = {}
    for height in sorted({item.get("height") for item in formats if item.get("vcodec") != "none" and item.get("height") in {360, 480, 720, 1080, 1440, 2160}}):
        candidates = [item for item in formats if item.get("height") == height and item.get("vcodec") != "none"]
        video = max((item.get("filesize") or item.get("filesize_approx") or ((item.get("tbr") or 0) * 1000 * duration / 8) for item in candidates), default=0)
        total = round(video + (audio_bitrate * 1000 * duration / 8))
        sizes[str(height)] = format_size(total)
        size_bytes[str(height)] = total
    return sizes, size_bytes


class Handler(BaseHTTPRequestHandler):
    server_version = "ClipForge"
    sys_version = ""

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://*.ytimg.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/download":
            self.download(parse_qs(parsed.query))
            return
        file_path = (PUBLIC_ROOT / ("index.html" if parsed.path == "/" else parsed.path.lstrip("/"))).resolve()
        if not file_path.is_file() or PUBLIC_ROOT not in file_path.parents:
            self.send_error(404)
            return
        content_type = "text/html; charset=utf-8" if file_path.suffix == ".html" else "text/css; charset=utf-8" if file_path.suffix == ".css" else "text/javascript; charset=utf-8"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/info":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_json(400, {"error": "Некорректный запрос."})
            return
        if length > MAX_REQUEST_BODY:
            self.send_json(413, {"error": "Запрос слишком большой."})
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Некорректный JSON."})
            return
        url = normalize_url(payload.get("url", ""))
        if not valid_url(url):
            self.send_json(400, {"error": "Вставьте корректную ссылку на YouTube."})
            return
        try:
            info = json.loads(run_ytdlp(["--dump-single-json", "--no-playlist", url]).stdout)
            heights = sorted({f.get("height") for f in info.get("formats", []) if f.get("vcodec") != "none" and f.get("height") in {360, 480, 720, 1080, 1440, 2160}})
            sizes, size_bytes = estimate_sizes(info)
            self.send_json(200, {"title": info.get("title"), "channel": info.get("channel") or info.get("uploader"), "duration": info.get("duration_string"), "thumbnail": info.get("thumbnail"), "heights": heights or [360, 480, 720], "sizes": sizes, "size_bytes": size_bytes})
        except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError):
            self.send_json(500, {"error": "Не удалось получить данные видео. Проверьте ссылку и установку yt-dlp."})

    def download(self, query):
        url = normalize_url(query.get("url", [""])[0])
        try:
            height = min(max(int(query.get("quality", [720])[0]), 144), 2160)
        except ValueError:
            height = 720
        if not valid_url(url):
            self.send_error(400, "Invalid URL")
            return
        command = [str(YTDLP), "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=android"]
        binary = ffmpeg_path()
        if binary:
            command += ["--ffmpeg-location", binary]
        command += ["--merge-output-format", "mp4", "-f", f"bv*[height<={height}]+ba/b[height<={height}]", "-o", "-", url]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Disposition", 'attachment; filename="clipforge-video.mp4"')
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while chunk := process.stdout.read(1024 * 64):
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        finally:
            stop_process_tree(process)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"ClipForge слушает {host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()