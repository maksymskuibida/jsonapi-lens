#!/usr/bin/env bash
#
# Rasterise `public/og.svg` into the PNGs the head and the manifest point at.
#
# Link previews are fetched by crawlers that will not render SVG — X and several
# chat clients skip it outright — so the card ships as a PNG. It is generated
# here rather than by the build because it changes about once a year, and making
# every `vite build` depend on a browser would be a poor trade.
#
# Headless Chrome does the rasterising because it is the only renderer on hand
# that reads woff2: the brand faces are variable woff2 files under
# node_modules/@fontsource-variable, and librsvg on macOS resolves fonts through
# CoreText, so it silently falls back to Helvetica for all of them. The wrapper
# page below declares the same three families the card names and inlines the
# SVG, which is what makes the type in the card the type on the site.
#
# Usage: scripts/render-og.sh   (from the repository root, after npm install)
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME — set CHROME=..."; exit 1; }
[ -d node_modules/@fontsource-variable ] || { echo "run npm install first"; exit 1; }

root=$(pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fonts="$root/node_modules/@fontsource-variable"

# Chrome writes its screenshot at the window size, so each target gets its own
# page sized to exactly that.
page() { # page <width> <height> <body-html> > file
  cat <<HTML
<!doctype html>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Martian Mono Variable";
    src: url("file://$fonts/martian-mono/files/martian-mono-latin-wght-normal.woff2") format("woff2-variations");
    font-weight: 100 800;
  }
  @font-face {
    font-family: "Instrument Sans Variable";
    src: url("file://$fonts/instrument-sans/files/instrument-sans-latin-wght-normal.woff2") format("woff2-variations");
    font-weight: 400 700;
  }
  @font-face {
    font-family: "JetBrains Mono Variable";
    src: url("file://$fonts/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2") format("woff2-variations");
    font-weight: 100 800;
  }
  html, body { margin: 0; padding: 0; background: transparent; }
  svg, img { display: block; }
</style>
$3
HTML
}

shot() { # shot <width> <height> <page-file> <out.png>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    --allow-file-access-from-files --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --window-size="$1,$2" --screenshot="$4" "file://$3" >/dev/null 2>&1
  [ -s "$4" ] || { echo "failed to render $4"; exit 1; }
}

# The card: the SVG is inlined rather than <img>-ed, because an <img> gets its
# own document and would not see the @font-face rules above.
page 1200 630 "$(cat public/og.svg)" > "$work/card.html"
shot 1200 630 "$work/card.html" public/og.png

# Raster icons for the manifest and for iOS, from the same favicon the page uses.
for size in 192 512; do
  page "$size" "$size" "<img src=\"file://$root/public/favicon.svg\" width=\"$size\" height=\"$size\">" \
    > "$work/icon-$size.html"
  shot "$size" "$size" "$work/icon-$size.html" "public/icon-$size.png"
done
page 180 180 "<img src=\"file://$root/public/favicon.svg\" width=\"180\" height=\"180\">" > "$work/apple.html"
shot 180 180 "$work/apple.html" public/apple-touch-icon.png

for file in public/og.png public/icon-192.png public/icon-512.png public/apple-touch-icon.png; do
  echo "$file — $(( $(wc -c < "$file") / 1024 )) kB"
done
