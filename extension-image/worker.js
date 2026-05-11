/**
 * Cloudflare Worker - Image Analysis Tool Payment Service
 *
 * Features:
 * 1. Hosts payment page (loads PayPal JS SDK)
 * 2. Provides create-subscription endpoint (PayPal Subscriptions API)
 * 3. Provides webhook endpoint for subscription lifecycle events
 * 4. Provides check endpoint for Pro subscription status
 * 5. Provides cancel-subscription endpoint
 *
 * Deploy:
 * wrangler deploy worker.js
 */

// ==================== Configuration ====================
const CONFIG = {
  MONTHLY_PRICE: '6.99',
  YEARLY_PRICE: '49.99',
  CURRENCY: 'USD',
  PRODUCT_NAME: 'Image Analysis Tool Pro',
  PRODUCT_CATEGORY: 'SOFTWARE',
  PLAN_INTERVAL: 'MONTH',
  PLAN_INTERVAL_COUNT: 1,

  RETURN_URL: 'https://divine-tooth-04b7.yingganfei.workers.dev/success',
  CANCEL_URL: 'https://divine-tooth-04b7.yingganfei.workers.dev/cancel',

  ALLOWED_ORIGINS: [
    'chrome-extension://*',
    'moz-extension://*',
    'edge-extension://*',
  ],
};

function getPayPalConfig(env) {
  const isLive = env.PAYPAL_MODE === 'live';
  return {
    CLIENT_ID: env.PAYPAL_CLIENT_ID,
    CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET,
    API_BASE: isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    WEBHOOK_ID: env.PAYPAL_WEBHOOK_ID || '',
  };
}

// ==================== Utilities ====================

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

async function getPayPalAccessToken(env) {
  const pp = getPayPalConfig(env);
  if (!pp.CLIENT_ID || !pp.CLIENT_SECRET) {
    throw new Error('PayPal credentials not configured');
  }
  const auth = btoa(`${pp.CLIENT_ID}:${pp.CLIENT_SECRET}`);

  const response = await fetch(`${pp.API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`Failed to get PayPal token: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ==================== PayPal Catalog Product ====================

async function createOrGetProduct(env, accessToken) {
  const cached = await env.PRO_ACCOUNTS.get('_product_id');
  if (cached) return cached;

  const pp = getPayPalConfig(env);
  const res = await fetch(`${pp.API_BASE}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: CONFIG.PRODUCT_NAME,
      description: 'Monthly subscription for Image Analysis Tool Pro',
      type: 'SERVICE',
      category: CONFIG.PRODUCT_CATEGORY,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to create product: ${data.message || res.status}`);

  const productId = data.id;
  await env.PRO_ACCOUNTS.put('_product_id', productId);
  return productId;
}

// ==================== PayPal Billing Plan ====================

async function createOrGetPlan(env, accessToken, productId, interval) {
  const cacheKey = interval === 'year' ? '_plan_id_yearly' : '_plan_id_monthly';
  const cached = await env.PRO_ACCOUNTS.get(cacheKey);
  if (cached) return cached;

  const isYearly = interval === 'year';
  const price = isYearly ? CONFIG.YEARLY_PRICE : CONFIG.MONTHLY_PRICE;
  const intervalUnit = isYearly ? 'YEAR' : 'MONTH';
  const intervalCount = 1;
  const label = isYearly ? 'year' : 'month';

  const pp = getPayPalConfig(env);
  const res = await fetch(`${pp.API_BASE}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      product_id: productId,
      name: `Image Analysis Tool Pro - $${price}/${label}`,
      description: `$${price}/${label} subscription for Image Analysis Tool Pro`,
      billing_cycles: [{
        frequency: {
          interval_unit: intervalUnit,
          interval_count: intervalCount,
        },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: {
            value: price,
            currency_code: CONFIG.CURRENCY,
          },
        },
      }],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to create plan: ${data.message || res.status}`);

  const planId = data.id;
  await env.PRO_ACCOUNTS.put(cacheKey, planId);
  return planId;
}

// ==================== PayPal Subscription ====================

async function createPayPalSubscription(env, account, interval) {
  const accessToken = await getPayPalAccessToken(env);
  const productId = await createOrGetProduct(env, accessToken);
  const planId = await createOrGetPlan(env, accessToken, productId, interval || 'month');
  const pp = getPayPalConfig(env);

  const res = await fetch(`${pp.API_BASE}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plan_id: planId,
      custom_id: account,
      subscriber: {
        email_address: account,
      },
      application_context: {
        brand_name: 'Image Analysis Tool',
        locale: 'en-US',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        payment_method: {
          payer_selected: 'PAYPAL',
          payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
        },
        return_url: CONFIG.RETURN_URL,
        cancel_url: CONFIG.CANCEL_URL,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to create subscription: ${data.message || res.status}`);

  return data;
}

async function getPayPalSubscription(env, subscriptionId) {
  const accessToken = await getPayPalAccessToken(env);
  const pp = getPayPalConfig(env);

  const res = await fetch(`${pp.API_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) return null;
  return await res.json();
}

async function cancelPayPalSubscription(env, subscriptionId) {
  const accessToken = await getPayPalAccessToken(env);
  const pp = getPayPalConfig(env);

  const res = await fetch(`${pp.API_BASE}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: 'Cancelled by user',
    }),
  });

  return res.ok;
}

// ==================== Webhook ====================

async function verifyWebhookSignature(env, body, headers) {
  const pp = getPayPalConfig(env);
  if (!pp.WEBHOOK_ID) return true;

  const accessToken = await getPayPalAccessToken(env);

  const verificationBody = {
    auth_algo: headers.get('PAYPAL-AUTH-ALGO'),
    cert_url: headers.get('PAYPAL-CERT-URL'),
    transmission_id: headers.get('PAYPAL-TRANSMISSION-ID'),
    transmission_sig: headers.get('PAYPAL-TRANSMISSION-SIG'),
    transmission_time: headers.get('PAYPAL-TRANSMISSION-TIME'),
    webhook_id: pp.WEBHOOK_ID,
    webhook_event: body,
  };

  const res = await fetch(`${pp.API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verificationBody),
  });

  if (!res.ok) return false;
  const result = await res.json();
  return result.verification_status === 'SUCCESS';
}

async function handleWebhookEvent(env, event) {
  const eventType = event.event_type;
  const resource = event.resource;

  if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const subscriptionId = resource.id;
    const account = resource.custom_id || resource.subscriber?.email_address;

    if (account && subscriptionId) {
      await env.PRO_ACCOUNTS.put(account, JSON.stringify({
        subscriptionId,
        status: 'ACTIVE',
        planId: resource.plan_id,
        subscriberEmail: resource.subscriber?.email_address,
        startTime: Date.now(),
        nextBillingTime: resource.billing_info?.next_billing_time
          ? new Date(resource.billing_info.next_billing_time).getTime()
          : null,
        amount: resource.billing_info?.last_payment?.amount?.value || CONFIG.MONTHLY_PRICE,
        currency: resource.billing_info?.last_payment?.amount?.currency_code || CONFIG.CURRENCY,
      }));
    }
  }

  if (eventType === 'PAYMENT.SALE.COMPLETED') {
    const subscriptionId = resource.billing_agreement_id;
    if (!subscriptionId) return;

    const subData = await getPayPalSubscription(env, subscriptionId);
    if (!subData) return;

    const account = subData.custom_id || subData.subscriber?.email_address;
    if (!account) return;

    const existing = await env.PRO_ACCOUNTS.get(account);
    const data = existing ? JSON.parse(existing) : {};

    data.status = 'ACTIVE';
    data.subscriptionId = subscriptionId;
    data.nextBillingTime = subData.billing_info?.next_billing_time
      ? new Date(subData.billing_info.next_billing_time).getTime()
      : null;
    data.lastPaymentTime = Date.now();
    data.amount = resource.amount?.total || resource.amount?.value || CONFIG.MONTHLY_PRICE;
    data.currency = resource.amount?.currency || CONFIG.CURRENCY;

    await env.PRO_ACCOUNTS.put(account, JSON.stringify(data));
  }

  if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
    const subscriptionId = resource.id;
    const account = resource.custom_id || resource.subscriber?.email_address;

    if (account) {
      const existing = await env.PRO_ACCOUNTS.get(account);
      const data = existing ? JSON.parse(existing) : {};
      data.status = 'CANCELLED';
      data.subscriptionId = subscriptionId;
      await env.PRO_ACCOUNTS.put(account, JSON.stringify(data));
    }
  }

  if (eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
    const subscriptionId = resource.id;
    const account = resource.custom_id || resource.subscriber?.email_address;

    if (account) {
      const existing = await env.PRO_ACCOUNTS.get(account);
      const data = existing ? JSON.parse(existing) : {};
      data.status = 'SUSPENDED';
      data.subscriptionId = subscriptionId;
      await env.PRO_ACCOUNTS.put(account, JSON.stringify(data));
    }
  }

  if (eventType === 'BILLING.SUBSCRIPTION.EXPIRED') {
    const subscriptionId = resource.id;
    const account = resource.custom_id || resource.subscriber?.email_address;

    if (account) {
      const existing = await env.PRO_ACCOUNTS.get(account);
      const data = existing ? JSON.parse(existing) : {};
      data.status = 'EXPIRED';
      data.subscriptionId = subscriptionId;
      await env.PRO_ACCOUNTS.put(account, JSON.stringify(data));
    }
  }
}

// ==================== Payment Page HTML ====================

function getPaymentPageHtml(account, clientId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Image Analysis Tool Pro - Subscribe</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo h1 {
      font-size: 24px;
      color: #333;
    }
    .logo .icon {
      font-size: 48px;
      margin-bottom: 8px;
    }
    .product {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .product h2 {
      font-size: 18px;
      color: #333;
      margin-bottom: 8px;
    }
    .product .features {
      list-style: none;
      margin: 16px 0;
    }
    .product .features li {
      padding: 8px 0;
      color: #666;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .product .features li::before {
      content: "✓";
      color: #10b981;
      font-weight: bold;
    }
    .price {
      text-align: center;
      margin: 24px 0;
    }
    .price .amount {
      font-size: 36px;
      font-weight: bold;
      color: #333;
    }
    .price .period {
      font-size: 16px;
      color: #666;
    }
    .account-info {
      background: #e0e7ff;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 24px;
      text-align: center;
      font-size: 14px;
      color: #4338ca;
    }
    #subscribe-button-container {
      text-align: center;
    }
    .subscribe-btn {
      width: 100%;
      padding: 14px;
      background: #0070ba;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .subscribe-btn:hover {
      background: #005c99;
    }
    .subscribe-btn:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }
    .loading {
      text-align: center;
      color: #666;
      padding: 20px;
    }
    .error {
      background: #fee2e2;
      color: #dc2626;
      padding: 12px;
      border-radius: 8px;
      text-align: center;
      margin-bottom: 16px;
    }
    .success {
      background: #d1fae5;
      color: #059669;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
    }
    .success h3 {
      margin-bottom: 8px;
    }
    .footer {
      text-align: center;
      margin-top: 24px;
      font-size: 12px;
      color: #999;
    }
    .cancel-link {
      display: block;
      text-align: center;
      margin-top: 16px;
      font-size: 13px;
      color: #94a3b8;
      text-decoration: underline;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <div class="icon">📷</div>
      <h1>Image Analysis Tool Pro</h1>
    </div>

    <div class="product">
      <h2>Pro Monthly Subscription</h2>
      <ul class="features">
        <li>WebP / AVIF Format Suggestions</li>
        <li>One-Click Image Location</li>
        <li>Hidden / Transparent Image Detection</li>
        <li>Size & Dimension Anomaly Audit</li>
        <li>Cancel Anytime</li>
      </ul>
    </div>

    <div class="price">
      <span class="amount">$${CONFIG.MONTHLY_PRICE}</span>
      <span class="period"> / month</span>
    </div>

    <div class="account-info">
      Account: <strong>${escapeHtml(account)}</strong>
    </div>

    <div id="subscribe-button-container">
      <button id="subscribeBtn" class="subscribe-btn">Subscribe with PayPal</button>
    </div>

    <div class="footer">
      Secured by PayPal &middot; Cancel anytime
    </div>
  </div>

  <script>
    const ACCOUNT = ${JSON.stringify(account)};
    const API_BASE = 'https://divine-tooth-04b7.yingganfei.workers.dev';

    document.getElementById('subscribeBtn').addEventListener('click', async function() {
      const btn = this;
      btn.disabled = true;
      btn.textContent = 'Redirecting to PayPal...';

      try {
        const response = await fetch(\`\${API_BASE}/create-subscription?account=\${encodeURIComponent(ACCOUNT)}\`);
        const data = await response.json();

        if (!data.id || !data.approvalUrl) {
          throw new Error(data.error || 'Failed to create subscription');
        }

        window.location.href = data.approvalUrl;
      } catch (err) {
        console.error('Subscription error:', err);
        alert('Failed to create subscription. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Subscribe with PayPal';
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==================== Main Entry ====================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // ===== Payment Page =====
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const account = url.searchParams.get('account') || '';

        if (!account) {
          return new Response(`
            <!DOCTYPE html>
            <html>
            <head><title>Error</title></head>
            <body style="text-align:center;padding:50px;font-family:sans-serif;">
              <h1>⚠️ Missing Account Information</h1>
              <p>Please access this page from the extension's subscribe button</p>
            </body>
            </html>
          `, {
            status: 400,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }

        const pp = getPayPalConfig(env);
        if (!pp.CLIENT_ID) {
          return new Response('PayPal CLIENT_ID not configured', { status: 500, headers: { 'Content-Type': 'text/plain' } });
        }

        return new Response(getPaymentPageHtml(account, pp.CLIENT_ID), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // ===== Create Subscription =====
      if (url.pathname === '/create-subscription') {
        const account = url.searchParams.get('account');
        const interval = url.searchParams.get('interval') || 'month';

        if (!account) {
          return new Response(JSON.stringify({ error: 'Missing account' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const subscription = await createPayPalSubscription(env, account, interval);
        const approveLink = subscription.links?.find(l => l.rel === 'approve');

        if (subscription.id && env.PRO_ACCOUNTS) {
          await env.PRO_ACCOUNTS.put(account, JSON.stringify({
            subscriptionId: subscription.id,
            status: 'PENDING',
            account: account,
            startTime: Date.now(),
          }));
        }

        return new Response(JSON.stringify({
          id: subscription.id,
          status: subscription.status,
          approvalUrl: approveLink?.href || null,
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ===== Cancel Subscription =====
      if (url.pathname === '/cancel-subscription' && request.method === 'POST') {
        const { account } = await request.json();

        if (!account) {
          return new Response(JSON.stringify({ error: 'Missing account' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const record = await env.PRO_ACCOUNTS.get(account);
        if (!record) {
          return new Response(JSON.stringify({ error: 'No active subscription' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const data = JSON.parse(record);

        if (data.subscriptionId) {
          await cancelPayPalSubscription(env, data.subscriptionId);
        }

        data.status = 'CANCELLED';
        await env.PRO_ACCOUNTS.put(account, JSON.stringify(data));

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ===== Webhook (PayPal subscription events) =====
      if (url.pathname === '/webhook' && request.method === 'POST') {
        const body = await request.json();
        const isValid = await verifyWebhookSignature(env, body, request.headers);

        if (!isValid) {
          return new Response(JSON.stringify({ error: 'Invalid signature' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        await handleWebhookEvent(env, body);

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ===== Check Pro Status =====
      if (url.pathname === '/check') {
        const account = url.searchParams.get('account');

        if (!account) {
          return new Response(JSON.stringify({ error: 'Missing account' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        let paid = false;
        let status = null;

        if (env.PRO_ACCOUNTS) {
          const record = await env.PRO_ACCOUNTS.get(account);

          if (record) {
            const data = JSON.parse(record);
            status = data.status;

            // 1. Active subscription → Pro
            if (data.subscriptionId) {
              const shouldVerify = data.status !== 'ACTIVE' || (data.nextBillingTime && Date.now() > data.nextBillingTime + 7 * 24 * 60 * 60 * 1000);
              if (shouldVerify) {
                const sub = await getPayPalSubscription(env, data.subscriptionId);
                if (sub) {
                  const subStatus = sub.status;
                  paid = subStatus === 'ACTIVE';
                  if (subStatus !== data.status) {
                    data.status = subStatus;
                    data.nextBillingTime = sub.billing_info?.next_billing_time
                      ? new Date(sub.billing_info.next_billing_time).getTime()
                      : data.nextBillingTime;
                    await env.PRO_ACCOUNTS.put(account, JSON.stringify(data));
                  }
                }
              } else {
                paid = data.status === 'ACTIVE';
              }

            // 2. Active trial → Pro
            } else if (data.trial && data.trialEnd) {
              if (Date.now() < data.trialEnd) {
                paid = true;
                status = 'TRIAL';
              } else {
                status = 'TRIAL_EXPIRED';
              }

            // 3. Subscription exists but not active
            } else {
              paid = false;
            }

          } else {
            // No record → first login, grant 7-day trial
            const trialEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
            await env.PRO_ACCOUNTS.put(account, JSON.stringify({
              trial: true,
              trialStart: Date.now(),
              trialEnd,
              status: 'TRIAL',
            }));
            paid = true;
            status = 'TRIAL';
          }
        }

        return new Response(JSON.stringify({ paid, status }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ===== Verify Order (backward compat) =====
      if (url.pathname === '/verify-order') {
        const subscriptionId = url.searchParams.get('orderId');

        if (!subscriptionId) {
          return new Response(JSON.stringify({ error: 'Missing subscriptionId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        try {
          const sub = await getPayPalSubscription(env, subscriptionId);
          return new Response(JSON.stringify({
            verified: sub?.status === 'ACTIVE',
            subscriptionId: sub?.id,
            status: sub?.status,
            amount: sub?.billing_info?.last_payment?.amount?.value || CONFIG.MONTHLY_PRICE,
            currency: sub?.billing_info?.last_payment?.amount?.currency_code || CONFIG.CURRENCY,
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } catch (error) {
          return new Response(JSON.stringify({ verified: false, error: error.message }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // ===== Notify (manual payment notification) =====
      if (url.pathname === '/notify' && request.method === 'POST') {
        const body = await request.json();
        const { account } = body;

        if (!account) {
          return new Response(JSON.stringify({ error: 'Missing account' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        if (env.PRO_ACCOUNTS) {
          const existing = await env.PRO_ACCOUNTS.get(account);
          const data = existing ? JSON.parse(existing) : {};
          data.status = 'ACTIVE';
          data.amount = data.amount || CONFIG.MONTHLY_PRICE;
          data.currency = data.currency || CONFIG.CURRENCY;
          await env.PRO_ACCOUNTS.put(account, JSON.stringify(data));
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ===== Success Page (PayPal redirect after subscription approval) =====
      if (url.pathname === '/success') {
        const subscriptionId = url.searchParams.get('subscription_id');

        if (subscriptionId) {
          try {
            const sub = await getPayPalSubscription(env, subscriptionId);
            if (sub && sub.status === 'ACTIVE') {
              const account = sub.custom_id || sub.subscriber?.email_address;
              if (account && env.PRO_ACCOUNTS) {
                await env.PRO_ACCOUNTS.put(account, JSON.stringify({
                  subscriptionId: sub.id,
                  status: 'ACTIVE',
                  planId: sub.plan_id,
                  subscriberEmail: sub.subscriber?.email_address,
                  startTime: Date.now(),
                  nextBillingTime: sub.billing_info?.next_billing_time
                    ? new Date(sub.billing_info.next_billing_time).getTime()
                    : null,
                  amount: sub.billing_info?.last_payment?.amount?.value || CONFIG.MONTHLY_PRICE,
                  currency: sub.billing_info?.last_payment?.amount?.currency_code || CONFIG.CURRENCY,
                }));
              }
            }
          } catch (e) {
            console.error('Success activation failed:', e);
          }
        }

        return new Response(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Subscription Successful</title>
            <style>
              body { font-family: sans-serif; text-align: center; padding: 50px; background: #f0fdf4; }
              .success { background: white; padding: 40px; border-radius: 16px; max-width: 400px; margin: 0 auto; }
              h1 { color: #059669; }
            </style>
          </head>
          <body>
            <div class="success">
              <h1>🎉 Subscription Successful!</h1>
              <p>Your Pro subscription is now active</p>
              <p>Return to the extension to see the update</p>
            </div>
          </body>
          </html>
        `, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // ===== Cancel Page =====
      if (url.pathname === '/cancel') {
        return new Response(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Subscription Cancelled</title>
            <style>
              body { font-family: sans-serif; text-align: center; padding: 50px; background: #fef2f2; }
              .cancel { background: white; padding: 40px; border-radius: 16px; max-width: 400px; margin: 0 auto; }
              h1 { color: #dc2626; }
            </style>
          </head>
          <body>
            <div class="cancel">
              <h1>⚠️ Subscription Cancelled</h1>
              <p>You can return to the extension anytime to subscribe</p>
            </div>
          </body>
          </html>
        `, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
