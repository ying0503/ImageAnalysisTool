# Design Notes

## Overview
- This is a Chrome image audit tool extension that captures all images on the current page and displays relevant information.
- Added a tab named "CSS" that lists all CSS resources on the page.
- Clicking the extension icon triggers image capture.

## Features
- Capture all images from the page without modifying URLs — preserve all query parameters.
- Images include `<img>` tags and CSS `background-image` elements.
- Image format detection: if not WebP and larger than 10KB, show a yellow "Not WebP" warning.
  - Files with "webp" in the filename are considered WebP format.
- Images exceeding 100KB show a yellow warning; exceeding 300KB shows a red warning.
- Image dimension comparison: if the natural size exceeds the rendered size by 2x, show a yellow warning with the ratio. Over 3x shows a red warning.
  - Account for Retina displays — skip warning at 2x, start warning at 3x.
- Badge count on the extension icon (white text on red background) showing the number of warnings.
- Clicking a thumbnail scrolls to the image's location on the page.
  - Fixed a bug where some thumbnails failed to scroll.
- Retry up to 3 times on load failure.
- Duplicate image URLs detected — show a yellow "Duplicate" warning on the second occurrence.

## CSS Audit
- Goal: optimize CSS bundle size.
- List all non-inline CSS resource files on the page.
- Display all external CSS files.

## UI Layout
- Width: 600px.
- Card-style list with white background. Thumbnails at 60x60px, maintaining aspect ratio. Show a loading animation before the image loads, then display the original image.
- Metadata displayed below the thumbnail. Image URL is not shown.
- SVG and data URI images displayed at 30x30px, grouped separately at the bottom with a divider line.
  - SVG and data URI images are listed only — no size, format, or dimension checks.

## Build
- Generate 4 files: popup.html, popup.js, manifest.json, popup.css.
- No additional files should be created.
- No README needed.
