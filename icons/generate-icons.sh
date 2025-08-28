#!/bin/bash

for size in 16 32 48 128; do
    cat > icon-${size}.svg << EOF
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="4" fill="url(#gradient)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial" font-size="$((size/3))" font-weight="bold">J</text>
  <defs>
    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
</svg>
EOF
    echo "Generated icon-${size}.svg"
done

echo "SVG icons generated. Convert to PNG using an image editor or online converter."