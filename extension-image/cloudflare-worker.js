const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

const MONTHLY_PRICE = '6.99';
const YEARLY_PRICE = '49.99';
const CURRENCY = 'USD';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/check') {
      const account = url.searchParams.get('account');
      if (!account) return json({ paid: false });

      const record = await env.PRO_ACCOUNTS.get(account);
      if (!record) {
        const trialEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
        await env.PRO_ACCOUNTS.put(account, JSON.stringify({
          trial: true,
          trialStart: Date.now(),
          trialEnd,
          status: 'TRIAL',
        }));
        return json({ paid: true, status: 'TRIAL' });
      }

      try {
        const data = JSON.parse(record);
        let paid = false;

        if (data.subscriptionId) {
          const subStatus = data.status;
          if (subStatus === 'ACTIVE') {
            paid = true;
          } else {
            try {
              const accessToken = await getPayPalAccessToken(env);
              const baseUrl = env.PAYPAL_MODE === 'live'
                ? 'https://api-m.paypal.com'
                : 'https://api-m.sandbox.paypal.com';
              const res = await fetch(`${baseUrl}/v1/billing/subscriptions/${data.subscriptionId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              });
              if (res.ok) {
                const sub = await res.json();
                paid = sub.status === 'ACTIVE';
                if (sub.status !== data.status) {
                  data.status = sub.status;
                  await env.PRO_ACCOUNTS.put(account, JSON.stringify(data));
                }
              }
            } catch (e) {
              console.error('Check fallback failed:', e);
            }
          }
        } else if (data.trial && data.trialEnd && Date.now() < data.trialEnd) {
          paid = true;
        }

        return json({ paid, status: data.status });
      } catch {
        return json({ paid: record === 'paid' });
      }
    }

    if (url.pathname === '/create-subscription') {
      try {
        const account = url.searchParams.get('account');
        const interval = url.searchParams.get('interval') || 'month';
        if (!account) return json({ error: 'Missing account' }, 400);

        const accessToken = await getPayPalAccessToken(env);
        const productId = await createOrGetProduct(env, accessToken);
        const planId = await createOrGetPlan(env, accessToken, productId, interval);

        const baseUrl = env.PAYPAL_MODE === 'live'
          ? 'https://api-m.paypal.com'
          : 'https://api-m.sandbox.paypal.com';

        const res = await fetch(`${baseUrl}/v1/billing/subscriptions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            plan_id: planId,
            custom_id: account,
            subscriber: { email_address: account },
            application_context: {
              brand_name: 'Image Analysis Tool',
              locale: 'en-US',
              shipping_preference: 'NO_SHIPPING',
              user_action: 'SUBSCRIBE_NOW',
              payment_method: {
                payer_selected: 'PAYPAL',
                payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
              },
              return_url: `${url.origin}/success`,
              cancel_url: `${url.origin}/cancel`,
            },
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Create subscription failed');

        const approveLink = data.links?.find(l => l.rel === 'approve');

        if (data.id && env.PRO_ACCOUNTS) {
          await env.PRO_ACCOUNTS.put(account, JSON.stringify({
            subscriptionId: data.id,
            status: 'PENDING',
            account,
            startTime: Date.now(),
          }));
        }

        return json({ id: data.id, status: data.status, approvalUrl: approveLink?.href });
      } catch (error) {
        return json({ error: error.message || 'Create subscription failed' }, 500);
      }
    }

    if (url.pathname === '/success') {
      const subscriptionId = url.searchParams.get('subscription_id');

      if (subscriptionId) {
        try {
          const accessToken = await getPayPalAccessToken(env);
          const baseUrl = env.PAYPAL_MODE === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
          const res = await fetch(`${baseUrl}/v1/billing/subscriptions/${subscriptionId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          });
          if (res.ok) {
            const sub = await res.json();
            if (sub.status === 'ACTIVE') {
              const account = sub.custom_id || sub.subscriber?.email_address;
              if (account && env.PRO_ACCOUNTS) {
                await env.PRO_ACCOUNTS.put(account, JSON.stringify({
                  subscriptionId: sub.id,
                  status: 'ACTIVE',
                  planId: sub.plan_id,
                  subscriberEmail: sub.subscriber?.email_address,
                  startTime: Date.now(),
                  nextBillingTime: sub.billing_info?.next_billing_time ? new Date(sub.billing_info.next_billing_time).getTime() : null,
                }));
              }
            }
          }
        } catch (e) {
          console.error('Success activation failed:', e);
        }
      }

      return new Response(`<!DOCTYPE html>
<html lang="en"><head><title>Subscribed</title><style>
body{font-family:sans-serif;text-align:center;padding:50px;background:#f0fdf4}
.card{background:white;padding:40px;border-radius:16px;max-width:400px;margin:0 auto}
h1{color:#059669}
</style></head><body><div class="card">
<h1>🎉 Subscribed!</h1><p>Your Pro subscription is active</p>
<p>Return to the extension</p>
</div></body></html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname === '/cancel') {
      return new Response(`<!DOCTYPE html>
<html lang="en"><head><title>Cancelled</title><style>
body{font-family:sans-serif;text-align:center;padding:50px;background:#fef2f2}
.card{background:white;padding:40px;border-radius:16px;max-width:400px;margin:0 auto}
h1{color:#dc2626}
</style></head><body><div class="card">
<h1>⚠️ Cancelled</h1><p>You can subscribe anytime from the extension</p>
</div></body></html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  }
};

async function getPayPalAccessToken(env) {
  const baseUrl = env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || 'Get PayPal access token failed');
  }

  return data.access_token;
}

async function createOrGetProduct(env, accessToken) {
  const cached = await env.PRO_ACCOUNTS.get('_product_id');
  if (cached) return cached;

  const baseUrl = env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const res = await fetch(`${baseUrl}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Image Analysis Tool Pro - Monthly',
      description: 'Monthly subscription for Image Analysis Tool Pro',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to create product: ${data.message || res.status}`);

  await env.PRO_ACCOUNTS.put('_product_id', data.id);
  return data.id;
}

async function createOrGetPlan(env, accessToken, productId, interval) {
  const cacheKey = interval === 'year' ? '_plan_id_yearly' : '_plan_id_monthly';
  const cached = await env.PRO_ACCOUNTS.get(cacheKey);
  if (cached) return cached;

  const isYearly = interval === 'year';
  const price = isYearly ? YEARLY_PRICE : MONTHLY_PRICE;
  const intervalUnit = isYearly ? 'YEAR' : 'MONTH';
  const label = isYearly ? 'year' : 'month';

  const baseUrl = env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const res = await fetch(`${baseUrl}/v1/billing/plans`, {
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
        frequency: { interval_unit: intervalUnit, interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: { value: price, currency_code: CURRENCY },
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

  await env.PRO_ACCOUNTS.put(cacheKey, data.id);
  return data.id;
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: CORS_HEADERS,
  });
}
