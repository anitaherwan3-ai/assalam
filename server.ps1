param([int]$Port = 8080)

$RootPath = $PSScriptRoot
if (-not $RootPath) { $RootPath = (Get-Location).Path }

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".mp4"  = "video/mp4"
    ".webm" = "video/webm"
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Warning "Port $Port sedang digunakan, mencoba port $($Port + 1)..."
    $Port = $Port + 1
    $prefix = "http://localhost:$Port/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " KLINIK SEHAT PRATAMA - WEB SERVER LOKAL BERJALAN         " -ForegroundColor Green
Write-Host " Alamat Aplikasi: $prefix                                  " -ForegroundColor Yellow
Write-Host " Layar TV HDMI  : ${prefix}display.html                    " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Keuntungan Server Lokal:                                  " -ForegroundColor White
Write-Host " - Bebas YouTube Error 153 (domain localhost valid)       " -ForegroundColor Gray
Write-Host " - Panggilan suara bel antrean TV aktif lancar            " -ForegroundColor Gray
Write-Host " - Bisa diakses komputer lain dalam 1 jaringan Wi-Fi      " -ForegroundColor Gray
Write-Host "`nTekan Ctrl+C di jendela ini untuk mematikan server.`n" -ForegroundColor DarkGray

# Buka browser otomatis
Start-Process "http://localhost:$Port/index.html"

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $rawUrl = $request.Url.LocalPath
        if ($rawUrl -eq "/" -or [string]::IsNullOrWhiteSpace($rawUrl)) {
            $rawUrl = "/index.html"
        }

        $localFile = Join-Path $RootPath ($rawUrl.TrimStart("/").Replace("/", "\"))

        if (Test-Path $localFile -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($localFile).ToLower()
            $mime = "application/octet-stream"
            if ($mimeTypes.ContainsKey($ext)) {
                $mime = $mimeTypes[$ext]
            }

            $bytes = [System.IO.File]::ReadAllBytes($localFile)
            $response.ContentType = $mime
            $response.ContentLength64 = $bytes.Length
            $response.AddHeader("Access-Control-Allow-Origin", "*")
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 File Not Found: $rawUrl")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.Close()
    } catch {
        # Listener stopped or interrupted
    }
}