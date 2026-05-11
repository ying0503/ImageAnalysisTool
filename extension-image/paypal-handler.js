/**
 * PayPal Payment Handler
 *
 * NOTE: This file is currently unused.
 * MV3 extensions do not allow loading remote scripts (e.g. PayPal JS SDK) in the popup.
 * The payment flow has been changed to:
 * 1. Extension opens Cloudflare-hosted payment page
 * 2. Payment page loads the official PayPal SDK to complete payment
 * 3. Worker writes to PRO_ACCOUNTS after successful capture
 * 4. Extension polls /check endpoint for automatic upgrade
 *
 * Kept as a reference for alternative approaches.
 */
