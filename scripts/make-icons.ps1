Add-Type -AssemblyName System.Drawing

# Same palette and geometry as public/favicon.svg, on a 64-unit grid.
function New-Mark {
  param([int]$Size, [string]$Path, [double]$Inset = 1.0)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#0f1020'))

  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#e9e9f4'))
  $muted = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#a3a6cb'))
  $action = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#9990ff'))

  # `Inset` shrinks the content for maskable icons so nothing important crops.
  $u = ($Size / 64.0) * $Inset
  $off = ($Size - (64 * $u)) / 2.0

  $rect = {
    param($x, $y, $w, $h, $brush)
    $g.FillRectangle(
      $brush,
      [single]($off + $x * $u),
      [single]($off + $y * $u),
      [single][math]::Max(1, $w * $u),
      [single][math]::Max(1, $h * $u)
    )
  }

  & $rect 31 12 2 40 $muted
  & $rect 22 14 20 2 $ink
  & $rect 24 24 16 2 $ink
  & $rect 24 40 16 2 $ink
  & $rect 22 50 20 2 $ink
  & $rect 16 30 32 5 $action

  $ink.Dispose()
  $muted.Dispose()
  $action.Dispose()
  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $Path"
}

$out = Resolve-Path (Join-Path $PSScriptRoot '..\public')
New-Mark -Size 192 -Path (Join-Path $out 'pwa-192x192.png')
New-Mark -Size 512 -Path (Join-Path $out 'pwa-512x512.png')
New-Mark -Size 512 -Path (Join-Path $out 'pwa-maskable-512x512.png') -Inset 0.62
New-Mark -Size 180 -Path (Join-Path $out 'apple-touch-icon.png') -Inset 0.82
