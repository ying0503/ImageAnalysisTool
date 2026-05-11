// Background Service Worker - handles API requests
const PRO_API_BASE = 'https://divine-tooth-04b7.yingganfei.workers.dev';
const GA_MEASUREMENT_ID = 'G-5VH20VM237';
const GA_API_SECRET = 'L6cdE2VRQFuNMLBjIgK1Kg'; // Obtain from GA admin panel

// Send Google Analytics event
async function sendGAEvent(eventName, params = {}) {
  try {
    const clientId = await getGAClientId();
    await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        events: [{
          name: eventName,
          params: {
            ...params,
            engagement_time_msec: '100'
          }
        }]
      })
    });
  } catch (e) {
    console.error('GA send failed:', e);
  }
}

// Get or generate GA Client ID
async function getGAClientId() {
  const result = await chrome.storage.local.get(['ga_client_id']);
  if (result.ga_client_id) return result.ga_client_id;
  const newId = crypto.randomUUID();
  await chrome.storage.local.set({ ga_client_id: newId });
  return newId;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'createSubscription') {
    const { account } = request;
    sendGAEvent('create_subscription', { account_hash: account.slice(0, 8) });
    fetch(`${PRO_API_BASE}/create-subscription?account=${encodeURIComponent(account)}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        sendGAEvent('create_subscription_success', { subscription_id: data.id });
        sendResponse({ success: true, data });
      })
      .catch(err => {
        sendGAEvent('create_subscription_failed', { error: err.message });
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === 'checkProStatus') {
    const { account } = request;
    fetch(`${PRO_API_BASE}/check?account=${encodeURIComponent(account)}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'notifyPayment') {
    const { account, orderId } = request;
    sendGAEvent('payment_complete', { account_hash: account.slice(0, 8), order_id: orderId });
    fetch(`${PRO_API_BASE}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, orderId })
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'trackEvent') {
    sendGAEvent(request.eventName, request.params);
    sendResponse({ success: true });
    return true;
  }
});

// Send event on extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    sendGAEvent('extension_install');
  } else if (details.reason === 'update') {
    sendGAEvent('extension_update', { previous_version: details.previousVersion });
  }
});
