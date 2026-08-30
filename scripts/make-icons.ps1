Add-Type -AssemblyName System.Drawing

# Draws the app mark at any size: the rail, its detents, and one judgement
# seated in vermilion. Same geometry as public/favicon.svg, on a 64-unit grid.
function New-Mark {
  param([int]$Size, [string]$Path, [double]$Inset = 1.0)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $g.Clear([System.Drawing.Color]::FromArgb(255, 26, 26, 26))

  $bone = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 239, 233, 221))
  $rubric = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 194, 58, 42))

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

  # Register marks at the corners.
  $t = 1.5
  foreach ($c in @(@(6, 6), @(53, 6), @(6, 53), @(53, 53))) {
    & $rect $c[0] $c[1] 5 $t $bone
    & $rect ($(if ($c[0] -lt 32) { $c[0] } else { $c[0] + 5 - $t })) $c[1] $t 5 $bone
  }

  # The rail, cut with detents.
  & $rect 24 13 2 38 $bone
  foreach ($y in @(13, 19, 25, 37, 43, 49.5)) { & $rect 20 $y 10 1.5 $bone }

  # The judgement, seated.
  & $rect 18 30 30 4 $rubric

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
