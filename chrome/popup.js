// DOM 元素
const normalList = document.getElementById('normalList');
const specialList = document.getElementById('specialList');
const stats = document.getElementById('stats');
const normalCount = document.getElementById('normalCount');
const specialCount = document.getElementById('specialCount');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      stats.textContent = '无法在此页面运行';
      return;
    }
    
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        func: collectImages
      },
      async (results) => {
        if (chrome.runtime.lastError) {
          stats.textContent = '执行脚本失败';
          return;
        }
        
        const images = results[0]?.result || [];
        await renderImages(images);
      }
    );
  });
});

/**
 * 在页面中执行的函数：收集所有图片
 */
function collectImages() {
  const images = [];
  const seenUrls = new Set();
  
  // 收集 img 标签
  document.querySelectorAll('img').forEach(img => {
    const src = img.currentSrc || img.src;
    if (!src || seenUrls.has(src)) return;
    seenUrls.add(src);
    
    const rect = img.getBoundingClientRect();
    const parentRect = img.parentElement?.getBoundingClientRect();
    
    images.push({
      src,
      element: img,
      type: 'img',
      width: rect.width,
      height: rect.height,
      parentWidth: parentRect?.width || 0,
      parentHeight: parentRect?.height || 0,
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX
    });
  });
  
  // 收集背景图片
  document.querySelectorAll('*').forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const match = bg.match(/url\(["']?(.*?)["']?\)/);
      if (match) {
        const src = match[1];
        if (!src || seenUrls.has(src)) return;
        seenUrls.add(src);
        
        const rect = el.getBoundingClientRect();
        const parentRect = el.parentElement?.getBoundingClientRect();
        
        images.push({
          src,
          element: el,
          type: 'background',
          width: rect.width,
          height: rect.height,
          parentWidth: parentRect?.width || 0,
          parentHeight: parentRect?.height || 0,
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX
        });
      }
    }
  });
  
  return images;
}

/**
 * 获取图片文件大小
 */
async function getImageSize(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const size = response.headers.get('content-length');
    return size ? parseInt(size, 10) : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * 检查图片问题
 */
async function auditImage(image) {
  const issues = [];
  
  // 检查是否为 WebP 格式
  const isWebP = image.src.toLowerCase().includes('.webp') || 
                 image.src.toLowerCase().includes('format,webp');
  if (!isWebP) {
    issues.push({ text: '需WebP', level: 'yellow' });
  }
  
  // 检查尺寸是否超过父元素2倍
  if (image.parentWidth > 0 || image.parentHeight > 0) {
    const widthRatio = image.parentWidth > 0 ? image.width / image.parentWidth : 0;
    const heightRatio = image.parentHeight > 0 ? image.height / image.parentHeight : 0;
    const maxRatio = Math.max(widthRatio, heightRatio);
    
    if (maxRatio > 2) {
      issues.push({ text: `尺寸超限(${maxRatio.toFixed(1)}倍)`, level: 'yellow' });
    }
  }
  
  // 检查文件大小
  const fileSize = await getImageSize(image.src);
  const fileSizeKB = fileSize / 1024;
  
  if (fileSizeKB > 100) {
    issues.push({ text: `体积过大(${fileSizeKB.toFixed(1)}KB)`, level: 'red' });
  } else if (fileSizeKB > 50) {
    issues.push({ text: `体积过大(${fileSizeKB.toFixed(1)}KB)`, level: 'yellow' });
  }
  
  return {
    ...image,
    issues,
    fileSizeKB,
    isSpecial: image.src.startsWith('data:') || image.src.endsWith('.svg')
  };
}

/**
 * 创建图片卡片
 */
function createImageCard(imageData) {
  const card = document.createElement('div');
  card.className = 'image-card';
  card.dataset.src = imageData.src;
  
  // 缩略图容器
  const thumbnail = document.createElement('div');
  thumbnail.className = `thumbnail ${imageData.isSpecial ? 'small' : 'standard'}`;
  
  // 加载状态
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'loading';
  thumbnail.appendChild(loading);
  
  // 图片元素
  const img = new Image();
  img.onload = () => {
    thumbnail.removeChild(loading);
    thumbnail.appendChild(img);
  };
  img.onerror = () => {
    loading.textContent = '加载失败';
    loading.style.color = '#ef4444';
  };
  img.src = imageData.src;
  
  // 图片信息
  const info = document.createElement('div');
  info.className = 'image-info';
  
  // 文件大小
  const size = document.createElement('div');
  size.className = 'size';
  size.textContent = imageData.fileSizeKB > 0 ? 
    `${imageData.fileSizeKB.toFixed(1)}KB` : '大小未知';
  info.appendChild(size);
  
  // 警告信息
  if (imageData.issues.length > 0) {
    const warnings = document.createElement('div');
    warnings.className = 'warnings';
    
    imageData.issues.forEach(issue => {
      const warning = document.createElement('div');
      warning.className = `warning ${issue.level}`;
      warning.textContent = issue.text;
      warnings.appendChild(warning);
    });
    
    info.appendChild(warnings);
  } else {
    const success = document.createElement('div');
    success.className = 'warning success';
    success.textContent = '正常';
    info.appendChild(success);
  }
  
  // 点击事件：滚动到图片位置
  card.addEventListener('click', () => {
    scrollToImage(imageData);
  });
  
  card.appendChild(thumbnail);
  card.appendChild(info);
  
  return card;
}

/**
 * 滚动到图片位置并显示红点
 */
function scrollToImage(imageData) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (imageInfo) => {
        // 创建红点
        function createRedDot() {
          const dot = document.createElement('div');
          dot.className = 'red-dot';
          dot.style.position = 'absolute';
          dot.style.width = '12px';
          dot.style.height = '12px';
          dot.style.background = '#ef4444';
          dot.style.borderRadius = '50%';
          dot.style.top = '-4px';
          dot.style.right = '-4px';
          dot.style.animation = 'pulse 0.6s ease-in-out infinite';
          dot.style.boxShadow = '0 0 0 2px rgba(239, 68, 68, 0.2)';
          dot.style.zIndex = '999999';
          return dot;
        }
        
        // 获取元素选择器
        function getElementSelector(element) {
          if (!element) return null;
          
          if (element.id) {
            return `#${element.id}`;
          }
          
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.split(' ').filter(c => c).join('.');
            if (classes) {
              return `${element.tagName.toLowerCase()}.${classes}`;
            }
          }
          
          return element.tagName.toLowerCase();
        }
        
        // 滚动到元素
        function scrollToElement(element) {
          if (!element) return false;
          
          try {
            const rect = element.getBoundingClientRect();
            const scrollY = window.scrollY + rect.top - 100;
            window.scrollTo({ top: scrollY, behavior: 'smooth' });
            
            // 添加红点
            const dot = createRedDot();
            element.style.position = 'relative';
            element.appendChild(dot);
            
            // 5秒后移除红点
            setTimeout(() => {
              if (dot.parentNode === element) {
                element.removeChild(dot);
              }
            }, 5000);
            
            return true;
          } catch (error) {
            return false;
          }
        }
        
        // 尝试找到元素
        let element = null;
        
        if (imageInfo.type === 'img') {
          // 查找 img 元素
          const imgs = document.querySelectorAll('img');
          for (const img of imgs) {
            const src = img.currentSrc || img.src;
            if (src === imageInfo.src) {
              element = img;
              break;
            }
          }
        } else if (imageInfo.type === 'background') {
          // 查找背景图片元素
          const elements = document.querySelectorAll('*');
          for (const el of elements) {
            const bg = getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none') {
              const match = bg.match(/url\(["']?(.*?)["']?\)/);
              if (match && match[1] === imageInfo.src) {
                element = el;
                break;
              }
            }
          }
        }
        
        // 如果找到元素，滚动到它
        if (element) {
          return scrollToElement(element);
        }
        
        // 如果没找到，尝试通过坐标滚动
        if (imageInfo.top > 0) {
          window.scrollTo({ top: imageInfo.top - 100, behavior: 'smooth' });
          return true;
        }
        
        return false;
      },
      args: [imageData]
    }, (results) => {
      if (results?.[0]?.result === false) {
        console.log('无法滚动到图片位置');
      }
    });
  });
}

/**
 * 渲染所有图片
 */
async function renderImages(images) {
  // 清空列表
  normalList.innerHTML = '';
  specialList.innerHTML = '';
  
  let normalImages = 0;
  let specialImages = 0;
  let warningCount = 0;
  
  // 处理每个图片
  for (const image of images) {
    const imageData = await auditImage(image);
    
    const card = createImageCard(imageData);
    
    if (imageData.isSpecial) {
      specialList.appendChild(card);
      specialImages++;
    } else {
      normalList.appendChild(card);
      normalImages++;
    }
    
    // 统计警告数量
    warningCount += imageData.issues.length;
  }
  
  // 更新统计信息
  normalCount.textContent = normalImages;
  specialCount.textContent = specialImages;
  stats.textContent = `共 ${images.length} 张图片，${warningCount} 个问题`;
  
  // 更新扩展图标徽章
  if (warningCount > 0) {
    chrome.action.setBadgeText({ text: String(warningCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}