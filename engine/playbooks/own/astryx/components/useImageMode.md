# useImageMode
Category: media.
Import: import { useImageMode } from '@astryxdesign/core';

Detects whether image is predominantly dark / light by sampling pixels via OffscreenCanvas. Uses APCA perceptual lightness (sRGB linearization + power curve) for accurate detection, esp. on saturated colors. Runs entirely off paint path: no visible canvas, no layout thrash. Supports regional sampling for detecting luminance where text overlays will appear. Returns null while loading + falls back gracefully on CORS / network errors.

## Do
- Pair w/ MediaTheme to automatically adapt text color over dynamic background images.
- Use region option to sample only area where text overlays will appear for more accurate results.

## Do not
- Use for images that change rapidly (e.g. video frames); each src change triggers new fetch + analysis.

## See also
- MediaTheme
- useMediaQuery
