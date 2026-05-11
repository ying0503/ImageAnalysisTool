# Privacy Policy for Image Analysis Tool

**Last updated:** May 11, 2026

## Data Collection

This extension collects minimal data necessary for subscription management and analytics:

### What we collect
- **Google account email address** — Used to associate your Pro subscription or 7-day trial status with your identity. Collected only when you voluntarily sign in via Google.
- **Anonymous usage events** — Non-personal events such as "popup opened", "subscription started", "trial activated". No browsing history, page content, or image data is included.

### What we do NOT collect
- Web pages you visit
- Images or their content
- Any other personal identifiable information beyond your Google email

## How data is used
- Your email is used solely to verify your Pro subscription or trial status when you use the extension.
- Anonymous events are used to measure feature adoption and improve the extension.

## Data storage
- Subscription and trial status is stored on **Cloudflare KV** (edge storage, US/EU regions).
- Anonymous analytics are sent to **Google Analytics**.
- Your login session is cached locally in Chrome's `storage.local` — it never leaves your browser except for the subscription checks above.

## Data sharing
We do not sell, trade, or share your data with third parties. The only services involved are:
- **Cloudflare Workers** — subscription/trial management
- **Google Analytics** — anonymous event tracking
- **PayPal** — payment processing (governed by PayPal's own privacy policy)

## Data retention
- Subscription data is retained for as long as your subscription is active. After cancellation or expiration, data is deleted within 90 days.
- Anonymous analytics events are retained for 26 months per Google Analytics policy.

## Contact
For privacy-related inquiries, please open an issue at: https://github.com/ying0503/ImageAnalysisTool/issues
