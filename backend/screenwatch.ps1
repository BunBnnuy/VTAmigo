# Captures the screen, a region, or a specific app's window; saves a PNG and
# prints OCR'd text lines. Uses the built-in Windows.Media.Ocr engine.
# With -ProcessName, captures that process's main window via PrintWindow (works
# even if the window is behind others); -X/-Y/-W/-H then crop inside the window.
# Exit codes: 0 = ok, 2 = no OCR language pack, 3 = target window not found.
param(
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [string]$ProcessName = "",
  [string]$OutFile = "$env:TEMP\aicompanion-screenwatch.png"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public struct WcRect { public int Left, Top, Right, Bottom; }
public static class WinCap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out WcRect rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out WcRect rect, int size);
}
"@

# Capture at real pixel resolution on high-DPI displays
[WinCap]::SetProcessDPIAware() | Out-Null

$bmp = $null

if ($ProcessName) {
  $name = $ProcessName -replace '\.exe$', ''
  $proc = Get-Process -Name $name -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1
  if (-not $proc) {
    [Console]::Error.WriteLine("WINDOW_NOT_FOUND")
    exit 3
  }
  $hwnd = $proc.MainWindowHandle

  # Real window bounds (without the invisible resize shadow); fall back to GetWindowRect
  $rect = New-Object WcRect
  $DWMWA_EXTENDED_FRAME_BOUNDS = 9
  $hr = [WinCap]::DwmGetWindowAttribute($hwnd, $DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect))
  if ($hr -ne 0) { [WinCap]::GetWindowRect($hwnd, [ref]$rect) | Out-Null }
  $winW = $rect.Right - $rect.Left
  $winH = $rect.Bottom - $rect.Top
  if ($winW -le 0 -or $winH -le 0 -or [WinCap]::IsIconic($hwnd)) {
    [Console]::Error.WriteLine("WINDOW_NOT_FOUND")
    exit 3
  }

  # PrintWindow (PW_RENDERFULLCONTENT=2) captures the window even when covered
  $bmp = New-Object System.Drawing.Bitmap($winW, $winH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [WinCap]::PrintWindow($hwnd, $hdc, 2)
  $g.ReleaseHdc($hdc)
  $g.Dispose()

  if (-not $ok) {
    # Some apps refuse PrintWindow — grab the window's screen area instead
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($winW, $winH)))
    $g.Dispose()
  }

  # Optional region = crop inside the window
  if ($W -gt 0 -and $H -gt 0) {
    $cx = [Math]::Max(0, $X); $cy = [Math]::Max(0, $Y)
    $cw = [Math]::Min($W, $bmp.Width - $cx); $ch = [Math]::Min($H, $bmp.Height - $cy)
    if ($cw -gt 0 -and $ch -gt 0) {
      $cropped = $bmp.Clone((New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), $bmp.PixelFormat)
      $bmp.Dispose()
      $bmp = $cropped
    }
  }
} else {
  if ($W -le 0 -or $H -le 0) {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $X = $bounds.X; $Y = $bounds.Y; $W = $bounds.Width; $H = $bounds.Height
  }
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($W, $H)))
  $g.Dispose()
}

# Windows OCR rejects images over ~2600px per side; smaller PNG also helps the vision model
$maxDim = 2000
if ($bmp.Width -gt $maxDim -or $bmp.Height -gt $maxDim) {
  $scale = [Math]::Min($maxDim / $bmp.Width, $maxDim / $bmp.Height)
  $nw = [int]($bmp.Width * $scale); $nh = [int]($bmp.Height * $scale)
  $scaled = New-Object System.Drawing.Bitmap($bmp, $nw, $nh)
  $bmp.Dispose()
  $bmp = $scaled
}

$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# ── OCR via built-in Windows.Media.Ocr (WinRT) ──
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($winRtTask, $resultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $netTask = $asTask.Invoke($null, @($winRtTask))
  $null = $netTask.Wait(-1)
  $netTask.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  [Console]::Error.WriteLine("OCR_UNAVAILABLE")
  exit 2
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($OutFile)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$softwareBitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()

foreach ($line in $result.Lines) { $line.Text }
