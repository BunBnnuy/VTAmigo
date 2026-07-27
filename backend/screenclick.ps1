# Finds on-screen text (an answer option) via OCR, clicks it, waits 3-5 s and
# clicks the same spot again to advance to the next question.
# -Center clicks the middle of the window/region without OCR; -Single skips the
# second advance click (used by the auto-navigation clicker).
# Capture logic mirrors screenwatch.ps1 (screen, region, or a process window).
# Exit codes: 0 = ok, 2 = no OCR language pack, 3 = window not found, 4 = text not found.
param(
  [string]$TargetText = "",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [string]$ProcessName = "",
  [int]$MinDelayMs = 3000,
  [int]$MaxDelayMs = 5000,
  [switch]$Center,
  [switch]$Single,
  [switch]$FirstOption,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public struct WcRect2 { public int Left, Top, Right, Bottom; }
public static class WinClick {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out WcRect2 rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out WcRect2 rect, int size);
}
"@

[WinClick]::SetProcessDPIAware() | Out-Null

# ── Capture (same rules as screenwatch.ps1) ──
$originX = 0; $originY = 0
$hwnd = [IntPtr]::Zero
$bmp = $null

if ($ProcessName) {
  $name = $ProcessName -replace '\.exe$', ''
  $proc = Get-Process -Name $name -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1
  if (-not $proc) { [Console]::Error.WriteLine("WINDOW_NOT_FOUND"); exit 3 }
  $hwnd = $proc.MainWindowHandle
  if ([WinClick]::IsIconic($hwnd)) { [WinClick]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 400 }

  $rect = New-Object WcRect2
  $hr = [WinClick]::DwmGetWindowAttribute($hwnd, 9, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect))
  if ($hr -ne 0) { [WinClick]::GetWindowRect($hwnd, [ref]$rect) | Out-Null }
  $winW = $rect.Right - $rect.Left
  $winH = $rect.Bottom - $rect.Top
  if ($winW -le 0 -or $winH -le 0) { [Console]::Error.WriteLine("WINDOW_NOT_FOUND"); exit 3 }

  $bmp = New-Object System.Drawing.Bitmap($winW, $winH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [WinClick]::PrintWindow($hwnd, $hdc, 2)
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  if (-not $ok) {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($winW, $winH)))
    $g.Dispose()
  }
  $originX = $rect.Left; $originY = $rect.Top

  if ($W -gt 0 -and $H -gt 0) {
    $cx = [Math]::Max(0, $X); $cy = [Math]::Max(0, $Y)
    $cw = [Math]::Min($W, $bmp.Width - $cx); $ch = [Math]::Min($H, $bmp.Height - $cy)
    if ($cw -gt 0 -and $ch -gt 0) {
      $cropped = $bmp.Clone((New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)), $bmp.PixelFormat)
      $bmp.Dispose()
      $bmp = $cropped
      $originX += $cx; $originY += $cy
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
  $originX = $X; $originY = $Y
}

# -Center: click the middle of the captured window/region — no OCR needed
$screenX = 0; $screenY = 0
if ($Center) {
  $screenX = [int]($originX + $bmp.Width / 2.0)
  $screenY = [int]($originY + $bmp.Height / 2.0)
  $bmp.Dispose()
}

if (-not $Center) {

# Downscale for OCR if needed, remembering the factor to map rects back to screen px
$scaleFactor = 1.0
$maxDim = 2000
if ($bmp.Width -gt $maxDim -or $bmp.Height -gt $maxDim) {
  $scaleFactor = [Math]::Min($maxDim / $bmp.Width, $maxDim / $bmp.Height)
  $nw = [int]($bmp.Width * $scaleFactor); $nh = [int]($bmp.Height * $scaleFactor)
  $scaled = New-Object System.Drawing.Bitmap($bmp, $nw, $nh)
  $bmp.Dispose()
  $bmp = $scaled
}

$tmpFile = Join-Path $env:TEMP "aicompanion-screenclick.png"
$bmp.Save($tmpFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# ── OCR with word bounding rects ──
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
if ($null -eq $engine) { [Console]::Error.WriteLine("OCR_UNAVAILABLE"); exit 2 }

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmpFile)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$softwareBitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()

# ── Match the target text against OCR lines ──
function Normalize([string]$s) {
  ($s.ToLowerInvariant() -replace '[^\p{L}\p{N} ]', ' ' -replace '\s+', ' ').Trim()
}

# -FirstOption: click the first line labeled "A)" (fallback when the exact
# option text can't be found on screen)
if ($FirstOption) {
  $best = $null
  $bestScore = 1.0
  foreach ($line in $result.Lines) {
    if ($line.Text -match '^\s*A\s*[\)\].:]') { $best = $line; break }
  }
  if ($null -eq $best) { [Console]::Error.WriteLine("TEXT_NOT_FOUND"); exit 4 }
} else {

$targetNorm = Normalize $TargetText
$targetWords = $targetNorm -split ' ' | Where-Object { $_.Length -gt 0 }
if ($targetWords.Count -eq 0) { [Console]::Error.WriteLine("TEXT_NOT_FOUND"); exit 4 }

$best = $null
$bestScore = 0.0
$bestExtra = [int]::MaxValue

foreach ($line in $result.Lines) {
  $lineNorm = Normalize $line.Text
  $lineWords = $lineNorm -split ' ' | Where-Object { $_.Length -gt 0 }
  if ($lineWords.Count -eq 0) { continue }
  $hits = 0
  foreach ($tw in $targetWords) { if ($lineWords -contains $tw) { $hits++ } }
  $score = $hits / $targetWords.Count
  $extra = [Math]::Abs($lineWords.Count - $targetWords.Count)
  if ($score -gt $bestScore -or ($score -eq $bestScore -and $extra -lt $bestExtra)) {
    $bestScore = $score; $bestExtra = $extra; $best = $line
  }
}

if ($null -eq $best -or $bestScore -lt 0.6) { [Console]::Error.WriteLine("TEXT_NOT_FOUND"); exit 4 }

} # end if ($FirstOption) / else

# Union of the line's word rects → center → back to screen coordinates
$minX = [double]::MaxValue; $minY = [double]::MaxValue; $maxX = 0.0; $maxY = 0.0
foreach ($word in $best.Words) {
  $r = $word.BoundingRect
  if ($r.X -lt $minX) { $minX = $r.X }
  if ($r.Y -lt $minY) { $minY = $r.Y }
  if (($r.X + $r.Width) -gt $maxX) { $maxX = $r.X + $r.Width }
  if (($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
}
$centerX = ($minX + $maxX) / 2.0
$centerY = ($minY + $maxY) / 2.0
$screenX = [int]($originX + ($centerX / $scaleFactor))
$screenY = [int]($originY + ($centerY / $scaleFactor))

} # end if (-not $Center)

$label = if ($Center) { "(centro)" } else { "`"$($best.Text)`"" }

if ($DryRun) {
  if ($Center) { Write-Output "FOUND center at $screenX,$screenY" }
  else { Write-Output "FOUND $label score=$([Math]::Round($bestScore, 2)) at $screenX,$screenY" }
  exit 0
}

# ── Click, wait 3-5 s, click again to advance ──
if ($hwnd -ne [IntPtr]::Zero) {
  [WinClick]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 350
}

$MOUSEEVENTF_LEFTDOWN = 0x02
$MOUSEEVENTF_LEFTUP = 0x04

[WinClick]::SetCursorPos($screenX, $screenY) | Out-Null
Start-Sleep -Milliseconds 80
[WinClick]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[WinClick]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "CLICKED $label at $screenX,$screenY"

if ($Single) { exit 0 }

$delay = Get-Random -Minimum $MinDelayMs -Maximum ($MaxDelayMs + 1)
Start-Sleep -Milliseconds $delay

[WinClick]::SetCursorPos($screenX, $screenY) | Out-Null
Start-Sleep -Milliseconds 80
[WinClick]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[WinClick]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "ADVANCED after $($delay)ms"
