// DOM elements
const normalList = document.getElementById('normalList');
const specialList = document.getElementById('specialList');
const specialContainer = document.getElementById('specialContainer');
const stats = document.getElementById('stats');
const authBox = document.getElementById('authBox');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const loginModal = document.getElementById('loginModal');
const closeModal = document.querySelector('.close-modal');
const googleLoginBtn = document.getElementById('googleLoginBtn');

const PRO_API_BASE = 'https://divine-tooth-04b7.yingganfei.workers.dev';

// Send analytics event (via background.js)
function trackEvent(eventName, params = {}) {
  chrome.runtime.sendMessage({ action: 'trackEvent', eventName, params });
}

// Send GA event directly (doesn't depend on background.js)
async function sendGA(eventName, params = {}) {
  try {
    const id = 'G-5VH20VM237';
    const secret = 'L6cdE2VRQFuNMLBjIgK1Kg';
    let cid = (await chrome.storage.local.get('ga_client_id')).ga_client_id;
    if (!cid) {
      cid = crypto.randomUUID();
      await chrome.storage.local.set({ ga_client_id: cid });
    }
    await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${id}&api_secret=${secret}`, {
      method: 'POST',
      body: JSON.stringify({ client_id: cid, events: [{ name: eventName, params: { ...params, engagement_time_msec: '100' } }] }),
    });
  } catch (e) {
    console.error('GA send failed:', e);
  }
}

let isLoggedIn = false;
let isPro = false;
let currentImages = [];
let pollInterval = null;

function getAccountId(user) {
  if (!user) return '';
  return user.email || user.id || '';
}

async function checkProStatus(user) {
  const account = getAccountId(user);
  if (!account) return { paid: false, status: null };

  try {
    const res = await fetch(`${PRO_API_BASE}/check?account=${encodeURIComponent(account)}`);
    const data = await res.json();
    return { paid: Boolean(data.paid), status: data.status || null };
  } catch {
    return { paid: false, status: null };
  }
}

/**
 * Start polling Pro status
 */
function startProStatusPolling(user, onPaid) {
  if (pollInterval) {
    clearInterval(pollInterval);
  }

  pollInterval = setInterval(async () => {
    try {
      const result = await checkProStatus(user);
      if (result.paid && !isPro) {
        isPro = true;
        user.isPro = true;
        user.proStatus = result.status;
        await persistUser(user);
        updateUIWithUser(user);
        if (currentImages.length > 0) renderImages(currentImages);
        if (onPaid) onPaid();
        clearInterval(pollInterval);
        pollInterval = null;
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, 3000);

  // Auto-stop after 5 minutes
  setTimeout(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }, 5 * 60 * 1000);
}

async function persistUser(user) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ user }, resolve);
  });
}

async function clearStoredUser() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['user'], resolve);
  });
}

async function syncUserProStatus(user) {
  try {
    const result = await checkProStatus(user);
    if (user.isPro !== result.paid || user.proStatus !== result.status) {
      const wasFree = !user.isPro;
      user.isPro = result.paid;
      user.proStatus = result.status;
      await persistUser(user);
      if (wasFree && result.paid && result.status === 'TRIAL') {
        sendGA('trial_started', { account_hash: getAccountId(user).slice(0, 8) });
      }
    }
    return result.paid;
  } catch (error) {
    console.error('Failed to sync Pro status:', error);
    return Boolean(user.isPro);
  }
}

/**
 * Modal logic
 */
const openModal = (e, source) => {
  if (e) e.preventDefault();
  sendGA('login_modal_open', { source: source || 'unknown' });
  loginModal.style.display = 'flex';
};

/**
 * Update UI with user info
 */
const updateUIWithUser = (user) => {
  const isUserPro = user.isPro || false;
  isPro = isUserPro;

  authBox.innerHTML = `
    <div class="user-profile">
      <span class="user-name">Hi, ${user.name}</span>
      <svg class="dropdown-arrow" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      <div class="user-dropdown">
        ${isUserPro ? `
          <div class="dropdown-item pro-status">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="#fbbf24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
            <span style="color: #fbbf24; font-weight: bold;">${user.proStatus === 'TRIAL' ? '7-Day Trial' : 'Pro Edition'}</span>
          </div>
          <div class="dropdown-item">
            <a href="https://join.slack.com/t/imageanalysistool/shared_invite/zt-3xd7cu8wk-RjXlSIj6ngRVw4qXXpSoYw" target="_blank" class="slack-link" style="color: #4a154b; text-decoration: none; font-size: 13px;">Join Slack</a>
          </div>
        ` : `
          <div class="dropdown-item">
            <button id="unlockProBtn" class="unlock-pro-btn">Unlock Pro</button>
          </div>
        `}
        <div class="dropdown-item">
          <button id="logoutBtn" style="color: #000;">Sign Out</button>
        </div>
      </div>
    </div>
  `;
  
  const unlockBtn = document.getElementById('unlockProBtn');
  const closePayModal = document.querySelector('.close-pay-modal');
  const payModal = document.getElementById('payModal');
  const buyBtn = document.getElementById('buyProBtn');

  if (unlockBtn) {
    unlockBtn.onclick = () => {
      trackEvent('unlock_pro_click');
      payModal.style.display = 'flex';
    };
  }

  let billingInterval = 'month';

  const billingOptions = document.querySelectorAll('.billing-option');
  billingOptions.forEach(btn => {
    btn.onclick = () => {
      billingOptions.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      billingInterval = btn.dataset.interval;

      const proPrice = document.getElementById('proPrice');
      const proInterval = document.getElementById('proInterval');
      const planSaving = document.getElementById('planSaving');
      if (billingInterval === 'year') {
        proPrice.textContent = '$49.99';
        proInterval.textContent = '/year';
        planSaving.style.display = 'block';
      } else {
        proPrice.textContent = '$6.99';
        proInterval.textContent = '/month';
        planSaving.style.display = 'none';
      }
    };
  });

  if (closePayModal) {
    closePayModal.onclick = () => {
      payModal.style.display = 'none';
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    };
  }

  if (buyBtn) {
    buyBtn.onclick = async () => {
      trackEvent('buy_pro_click');
      const account = getAccountId(user);
      if (!account) { alert('Please sign in first.'); return; }

      buyBtn.disabled = true;
      buyBtn.textContent = 'Redirecting...';

      try {
        const res = await fetch(`${PRO_API_BASE}/create-subscription?account=${encodeURIComponent(account)}&interval=${billingInterval}`);
        const data = await res.json();

        if (!data.approvalUrl) {
          throw new Error(data.error || 'No approval URL');
        }

        sendGA('create_subscription', { account_hash: account.slice(0, 8), interval: billingInterval });

        chrome.tabs.create({ url: data.approvalUrl }, function() {
          if (chrome.runtime.lastError) {
            buyBtn.disabled = false;
            buyBtn.textContent = 'Subscribe with PayPal';
            alert('Failed to open subscription page. Please try again.');
            return;
          }
          startProStatusPolling(user, function() {
            sendGA('subscription_activated');
            payModal.style.display = 'none';
            buyBtn.disabled = false;
            buyBtn.textContent = 'Subscribe with PayPal';
            alert('🎉 Pro subscription activated!');
          });
        });
      } catch (err) {
        sendGA('create_subscription_failed', { error: err.message });
        buyBtn.disabled = false;
        buyBtn.textContent = 'Subscribe with PayPal';
        alert('Failed to create subscription: ' + err.message);
      }
    };
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      clearStoredUser().then(() => {
        isLoggedIn = false;
        isPro = false;
        authBox.innerHTML = `
          <a href="#" id="loginBtn">Sign In</a>
          <span class="divider-v">|</span>
          <a href="#" id="registerBtn">Sign Up</a>
        `;
        document.getElementById('loginBtn').onclick = (e) => openModal(e, 'login');
        document.getElementById('registerBtn').onclick = (e) => openModal(e, 'signup');
        if (currentImages.length > 0) renderImages(currentImages);
      });
    };
  }
};

/**
 * Initialization
 */
document.addEventListener('DOMContentLoaded', () => {
  sendGA('popup_open');
  trackEvent('popup_open');
  chrome.storage.local.get(['user'], (result) => {
    if (result.user) {
      isLoggedIn = true;
      const previousIsPro = Boolean(result.user.isPro);
      updateUIWithUser(result.user);
      syncUserProStatus(result.user).then((paid) => {
        if (previousIsPro !== paid) {
          updateUIWithUser(result.user);
          if (currentImages.length > 0) renderImages(currentImages);
        }
      });
    } else {
      if (loginBtn) loginBtn.onclick = (e) => openModal(e, 'login');
      if (registerBtn) registerBtn.onclick = (e) => openModal(e, 'signup');
    }
  });

  if (closeModal) closeModal.onclick = () => loginModal.style.display = 'none';
  var payModal = document.getElementById('payModal');
  window.onclick = function(e) {
    if (e.target === loginModal) loginModal.style.display = 'none';
    if (e.target === payModal) {
      payModal.style.display = 'none';
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    }
  };

  if (googleLoginBtn) {
    googleLoginBtn.onclick = () => {
      sendGA('google_login_start');
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          sendGA('google_login_failed', { error: chrome.runtime.lastError.message });
          return;
        }
        fetch('https://www.googleapis.com/oauth2/v2/userinfo?access_token=' + token)
          .then(r => r.json())
          .then(async (user) => {
            loginModal.style.display = 'none';
            isLoggedIn = true;
            sendGA('google_login_success', { account_hash: getAccountId(user).slice(0, 8) });
            user.isPro = await syncUserProStatus(user);
            await persistUser(user);
            updateUIWithUser(user);
            if (currentImages.length > 0) renderImages(currentImages);
          })
          .catch((err) => {
            sendGA('google_login_failed', { error: err.message });
          });
      });
    };
  }

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      if (stats) stats.textContent = 'Cannot run here';
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectImagesBasic
    }, (results) => {
      if (chrome.runtime.lastError) return;
      currentImages = results[0]?.result || [];
      renderImages(currentImages);
      fetchImageSizes(tab.id, currentImages);
    });
  });
});

function collectImagesBasic() {
  const images = [];
  const seenUrls = new Set();
  const viewportHeight = window.innerHeight;
  const allImgs = Array.from(document.querySelectorAll('img'));
  allImgs.forEach(img => {
    const src = img.currentSrc || img.src;
    if (!src || seenUrls.has(src)) return;
    seenUrls.add(src);
    const rect = img.getBoundingClientRect();
    const style = getComputedStyle(img);
    images.push({
      src, type: 'img',
      width: rect.width, height: rect.height,
      naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0,
      isInViewport: rect.top < viewportHeight && rect.bottom > 0,
      isHidden: style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || (rect.width === 0 && rect.height === 0),
      fileSize: 0
    });
  });
  const allEls = Array.from(document.querySelectorAll('*'));
  allEls.forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const match = bg.match(/url\(["']?(.*?)["']?\)/);
      if (match) {
        const src = match[1];
        if (!src || seenUrls.has(src)) return;
        seenUrls.add(src);
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        images.push({
          src, type: 'background',
          width: rect.width, height: rect.height,
          naturalWidth: 0, naturalHeight: 0,
          isInViewport: rect.top < viewportHeight && rect.bottom > 0,
          isHidden: style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || (rect.width === 0 && rect.height === 0),
          fileSize: 0
        });
      }
    }
  });
  return images;
}

function fetchImageSizes(tabId, images) {
  images.forEach((img, index) => {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: async (url) => {
        try {
          const res = await fetch(url, { method: 'HEAD' });
          let size = res.headers.get('content-length');
          if (!size) {
            const f = await fetch(url);
            size = (await f.blob()).size;
          }
          return parseInt(size);
        } catch (e) { return 0; }
      },
      args: [img.src]
    }, (results) => {
      const size = results[0]?.result || 0;
      currentImages[index].fileSize = size;
      const card = document.querySelector(`.image-card[data-src="${CSS.escape(img.src)}"]`);
      if (card) {
        const sizeEl = card.querySelector('.size');
        if (sizeEl) sizeEl.textContent = size > 0 ? `${(size/1024).toFixed(1)}KB` : 'Unknown';
        const newData = auditImage(currentImages[index]);
        if (isPro && !newData.isSpecial) {
           let warnings = card.querySelector('.warnings');
           if (!warnings) {
             warnings = document.createElement('div');
             warnings.className = 'warnings';
             card.querySelector('.image-info').appendChild(warnings);
           }
           warnings.innerHTML = '';
           newData.issues.forEach(issue => {
             const w = document.createElement('div');
             w.className = `warning ${issue.level}`;
             w.textContent = issue.text;
             warnings.appendChild(w);
           });
        }
      }
    });
  });
}

function auditImage(image) {
  const isSpecial = image.src.startsWith('data:') || image.src.toLowerCase().includes('.svg');
  const fileSizeKB = (image.fileSize || 0) / 1024;
  const issues = [];
  if (!isSpecial) {
    const isWebP = image.src.toLowerCase().includes('.webp') || image.src.toLowerCase().includes('format=webp');
    if (!isWebP && fileSizeKB > 10) issues.push({ text: 'Not WebP', level: 'yellow' });
    if (fileSizeKB > 300) issues.push({ text: `${fileSizeKB.toFixed(0)}KB`, level: 'red' });
    else if (fileSizeKB > 100) issues.push({ text: `${fileSizeKB.toFixed(0)}KB`, level: 'yellow' });
    if (image.naturalWidth > 0 && image.width > 0) {
      const ratio = Math.max(image.naturalWidth / image.width, image.naturalHeight / image.height);
      if (ratio > 3) issues.push({ text: `Size:${ratio.toFixed(1)}x`, level: 'red' });
      else if (ratio > 2) issues.push({ text: `Size:${ratio.toFixed(1)}x`, level: 'yellow' });
    }
  }
  return { ...image, issues, fileSizeKB, isSpecial };
}

function createImageCard(data) {
  const card = document.createElement('div');
  card.className = 'image-card';
  card.dataset.src = data.src;
  const thumbnail = document.createElement('div');
  thumbnail.className = `thumbnail ${data.isSpecial ? 'small' : 'standard'}`;
  if (isPro && data.isHidden && !data.isSpecial) {
    const badge = document.createElement('div');
    badge.className = 'hidden-badge';
    badge.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
    card.appendChild(badge);
  }
  const img = new Image();
  img.src = data.src;
  thumbnail.appendChild(img);
  const info = document.createElement('div');
  info.className = 'image-info';
  const sizeText = document.createElement('div');
  sizeText.className = 'size';
  sizeText.textContent = data.fileSize > 0 ? `${(data.fileSize/1024).toFixed(1)}KB` : 'Checking...';
  info.appendChild(sizeText);
  if (!data.isSpecial && isPro && data.issues.length > 0) {
    const warnings = document.createElement('div');
    warnings.className = 'warnings';
    data.issues.forEach(issue => {
      const w = document.createElement('div');
      w.className = `warning ${issue.level}`;
      w.textContent = issue.text;
      warnings.appendChild(w);
    });
    info.appendChild(warnings);
  }
  card.onclick = () => {
    if (!isLoggedIn) return;
    if (!isPro) {
      document.getElementById('payModal').style.display = 'flex';
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (info) => {
          const el = Array.from(document.querySelectorAll(info.type === 'img' ? 'img' : '*')).find(i => {
            const src = info.type === 'img' ? (i.currentSrc || i.src) : getComputedStyle(i).backgroundImage;
            return src && src.includes(info.src);
          });
          if (!el) return;

          el.scrollIntoView({ block: 'center' });

          setTimeout(() => {
            const dot = document.createElement('div');
            dot.id = '__imgAuditDot';
            dot.style.cssText = [
              'position:fixed',
              'width:24px;height:24px',
              'border-radius:50%',
              'z-index:2147483647',
              'pointer-events:none',
              'transform:translate(-50%,-50%)',
            ].join(';');
            document.body.appendChild(dot);

            let hue = 40;
            let running = true;

            function update() {
              if (!running) return;
              const r = el.getBoundingClientRect();
              dot.style.left = (r.left + r.width / 2) + 'px';
              dot.style.top = (r.top + r.height / 2) + 'px';
              dot.style.background = `hsl(${hue}, 90%, 55%)`;
              const pulse = 8 + Math.sin(Date.now() / 200) * 6;
              dot.style.boxShadow = `0 0 0 ${pulse}px hsla(${hue}, 90%, 55%, 0.5)`;
              dot.style.transform = `translate(-50%,-50%) scale(${1 + Math.sin(Date.now() / 250) * 0.15})`;
              hue = (hue + 8) % 360;
              requestAnimationFrame(update);
            }

            update();

            setTimeout(() => {
              running = false;
              dot.remove();
            }, 3000);
          }, 200);
        },
        args: [data]
      });
    });
    window.close();
  };
  card.appendChild(thumbnail);
  card.appendChild(info);
  return card;
}

function renderImages(images) {
  if (!images || !normalList) return;
  normalList.innerHTML = '';
  specialList.innerHTML = '';
  let hasSpecial = false;
  images.forEach(img => {
    const data = auditImage(img);
    const card = createImageCard(data);
    if (data.isSpecial) { specialList.appendChild(card); hasSpecial = true; }
    else normalList.appendChild(card);
  });
  if (specialContainer) specialContainer.style.display = hasSpecial ? '' : 'none';
  if (stats) stats.textContent = `${images.length} images total`;
}
