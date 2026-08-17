Add-Type -AssemblyName System.Drawing

$assetDirectory = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null

$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$path.AddArc(16, 16, 72, 72, 180, 90)
$path.AddArc(168, 16, 72, 72, 270, 90)
$path.AddArc(168, 168, 72, 72, 0, 90)
$path.AddArc(16, 168, 72, 72, 90, 90)
$path.CloseFigure()
$graphics.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(23, 33, 43)), $path)

$font = [System.Drawing.Font]::new('Segoe UI', 124, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('C', $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(16, 4, 224, 240), $format)

$pngPath = Join-Path $assetDirectory 'icon.png'
$icoPath = Join-Path $assetDirectory 'icon.ico'
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create($icoPath)
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
$font.Dispose()
$format.Dispose()
$path.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
