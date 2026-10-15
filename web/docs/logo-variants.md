# Business logo variants

Open **Business Settings → Profile & logo**. Access follows the existing Profile & logo tab permission.

1. Keep the original logo as a fallback, or upload it in the original Logo field.
2. Choose a layout: Complete logo, Stacked (label below), Horizontal (label beside), Wordmark, or Icon.
3. Upload a version for light backgrounds and/or dark backgrounds. These are separate artwork files; the app does not recolor or rearrange a logo.
4. Choose the sidebar and browser tab layouts here. For documents, open **Receipts**, choose **Receipt printer (80 mm / 58 mm)** or **Full page (A4 / A5)**, then choose **Logo for this document size**. Each size saves independently; full-page selection also applies to quotes, comparisons and report PDFs.
5. Click **Save logo** for uploads and app logo choices, and **Save receipt settings** for paper-size logo choices. Preview panels show unsaved changes; the rest of the app uses saved settings.

PNG and JPEG uploads are accepted up to 5 MB. Transparent PNG is recommended. Images retain their proportions and are resized to at most 640 pixels on the longest edge. Each processed image must be at most approximately 250 KB. All settings together have a 4 MB server limit.

The sidebar selects a color variant for its actual surface color, including custom backgrounds. Documents use the light-background version; thermal output still converts that selected logo to black ink. The favicon follows the device's resolved app theme. Installed PWA icons retain the application icon.

If the selected layout is missing a color version, the app tries other layouts with the matching background, then the original logo, then another available version. Removing all logos restores the business name and default app favicon. Existing saved settings continue to work without re-uploading a logo.

Logo images and selections are stored in the existing business-scoped settings record, cached for offline viewing, and included in the existing settings history and version conflict checks. Settings must be saved online. The database migration expands the payload budget and allows only Profile & logo editors to change logo variants and usage.

Verification: `node --test tests/*.test.mjs`. New tests cover legacy profiles, independent background/layout selection, missing/removed images, and invalid image/usage rejection.
