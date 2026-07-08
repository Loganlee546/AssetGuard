function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let assets = JSON.parse(localStorage.getItem("assetGuard_assets")) || [];
let html5QrScanner = null;
let activeCategory = "All";
let activeStatus = "All";
let searchQuery = "";
let isScannerStarting = false;
let shouldStopScanner = false;
let currentLanguage = localStorage.getItem("assetGuard_lang") || "en";
let apiConfig = JSON.parse(localStorage.getItem("assetGuard_api_config")) || {
  cloudId: "",
  workspaceId: "",
  token: ""
};

// State persistence
function saveState() {
  localStorage.setItem("assetGuard_assets", JSON.stringify(assets));
  localStorage.setItem("assetGuard_lang", currentLanguage);
  localStorage.setItem("assetGuard_api_config", JSON.stringify(apiConfig));
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  // Initialize Data from LocalStorage or use Seeds
  const savedAssets = localStorage.getItem("assetGuard_assets");
  const seeds = window.itAssetSeeds || [];
  
  if (savedAssets) {
    try {
      assets = JSON.parse(savedAssets);
    } catch (e) {
      console.error("Failed to parse local storage assets, resetting.", e);
      assets = seeds;
    }
  } else {
    // First time load or storage cleared: use seeds
    assets = seeds;
    saveState();
  }

  // Initial Render
  updateMetrics();
  renderAssetList();
  applyTranslations(currentLanguage);
  setupEventListeners();
});
// Atlassian API Sync Logic
async function syncWithAtlassian() {
  if (!apiConfig.cloudId || !apiConfig.workspaceId || !apiConfig.email || !apiConfig.token) {
    showToast(t("notif_sync_error").replace("{error}", "Missing API Config (Cloud ID, Workspace ID, Email, or Token)"), "error");
    openModal("settings-modal");
    return;
  }

  showToast(t("sync_loading"), "info");

  // Define the common Atlassian Assets API path variants
  // We extract the site name from the configuration to support direct subdomain routing
  const siteSubdomain = apiConfig.cloudId.includes("-") ? "smm-sandbox" : apiConfig.cloudId;
  
  const paths = [
    `https://${siteSubdomain}.atlassian.net/gateway/api/jsm/assets/workspace/${apiConfig.workspaceId}/v1/object/aql`,
    `https://api.atlassian.com/ex/jira/${apiConfig.cloudId}/jsm/assets/workspace/${apiConfig.workspaceId}/v1/object/aql`,
    `https://api.atlassian.com/ex/jira/${apiConfig.cloudId}/assets/workspace/${apiConfig.workspaceId}/v1/object/aql`,
    `https://api.atlassian.com/jsm/assets/workspace/${apiConfig.workspaceId}/v1/object/aql`
  ];

  let success = false;
  let lastError = null;
  let remoteAssets = [];

  for (let i = 0; i < paths.length; i++) {
    const currentUrl = `${paths[i]}?cb=${Date.now()}`;
    console.log(`Attempting Sync Path ${i + 1}/${paths.length}:`, currentUrl);

    try {
      const auth = btoa(`${apiConfig.email}:${apiConfig.token}`);
      const response = await fetch(currentUrl, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-ExperimentalApi": "opt-in"
        },
        body: JSON.stringify({
          qlQuery: "objectType != null",
          includeAttributes: true
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.values) {
          remoteAssets = data.values.map(mapAtlassianObject);
          success = true;
          console.log(`Sync succeeded on Path ${i + 1}!`);
          break; // Stop trying other paths
        }
      } else {
        const errText = await response.text();
        lastError = new Error(`HTTP ${response.status}: ${errText || response.statusText}`);
        console.warn(`Path ${i + 1} failed:`, lastError.message);
      }
    } catch (err) {
      lastError = err;
      console.warn(`Path ${i + 1} execution error:`, err.message);
    }
  }

  if (success) {
    // Merge strategy: Remote Overwrite
    remoteAssets.forEach(remote => {
      const index = assets.findIndex(a => a.id.toLowerCase() === remote.id.toLowerCase());
      if (index !== -1) {
        assets[index] = { ...assets[index], ...remote };
      } else {
        assets.push(remote);
      }
    });

    saveState();
    updateMetrics();
    renderAssetList();
    showToast(t("notif_sync_success").replace("{count}", remoteAssets.length), "success");
  } else {
    console.error("All sync paths failed. Last error:", lastError);
    showToast(t("notif_sync_error").replace("{error}", lastError ? lastError.message : "404 Not Found"), "error");
  }
}

function mapAtlassianObject(obj) {
  const getAttr = (name) => {
    if (!obj.attributes) return "";
    const attr = obj.attributes.find(a => a.objectTypeAttribute && a.objectTypeAttribute.name.toLowerCase() === name.toLowerCase());
    return attr && attr.objectAttributeValues && attr.objectAttributeValues.length > 0 ? attr.objectAttributeValues[0].displayValue : "";
  };

  return {
    id: obj.label || obj.id,
    name: obj.name || obj.label || obj.id,
    model: getAttr("Model") || obj.name || "Standard Model",
    category: getAttr("Category") || "IT Asset",
    status: getAttr("Status") || "Open",
    owner: getAttr("Owner") || "",
    condition: "Good",
    serial: getAttr("Serial Number") || getAttr("Serial") || "N/A",
    location: getAttr("Location") || "Corporate Office",
    lastUpdated: new Date().toLocaleDateString(),
    history: [{
      date: new Date().toLocaleDateString(),
      type: "Sync",
      user: "System",
      note: "Synchronized from Atlassian Assets"
    }],
    specs: {
      cpu: getAttr("CPU") || "---",
      ram: getAttr("RAM") || "---",
      storage: getAttr("Storage") || "---",
      os: getAttr("OS") || "---"
    }
  };
}

// Translation Helper
function t(key, params = {}) {
  const dict = translations[currentLanguage] || translations["en"];
  let text = dict[key] || translations["en"][key] || key;
  
  // Replace parameters like {name} with values from params object
  for (const [pKey, pVal] of Object.entries(params)) {
    // If the param value itself is a translation key, translate it
    const translatedVal = dict[pVal] || translations["en"][pVal] || pVal;
    text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), translatedVal);
  }
  
  return text;
}

// Apply translations to the whole UI
function applyTranslations(lang) {
  currentLanguage = lang;
  
  // Update UI Elements with data-i18n
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  
  // Update placeholders
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key);
  });

  // Refresh dynamic content
  updateMetrics();
  renderAssetList();
}

// Audio Synthesizer Beep
function playBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime); 
    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime); 
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.12); 
  } catch (e) {
    console.warn("Audio Context sound failed (permissions may be blocked):", e);
  }
}

// Toast System
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let icon = '<i class="fa-solid fa-circle-info"></i>';
  if (type === "success") icon = '<i class="fa-solid fa-circle-check"></i>';
  if (type === "error") icon = '<i class="fa-solid fa-circle-xmark"></i>';
  
  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Metrics Panel Updater
function updateMetrics() {
  const totalCount = assets.length;
  const openCount = assets.filter(a => a.status === "Open").length;
  const ownedCount = assets.filter(a => a.status === "Owned").length;
  const brokenCount = assets.filter(a => a.status === "Not Working").length;

  document.getElementById("metric-total").textContent = totalCount;
  document.getElementById("metric-open").textContent = openCount;
  document.getElementById("metric-owned").textContent = ownedCount;
  document.getElementById("metric-broken").textContent = brokenCount;
}

// Render Asset Catalog List
function renderAssetList() {
  const grid = document.getElementById("asset-list-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const terms = searchQuery.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);

  const filtered = assets.filter(asset => {
    let categoryMatch = (activeCategory === "All") || (activeCategory === asset.category);
    let statusMatch = (activeStatus === "All") || (activeStatus === asset.status);

    const searchMatch = terms.every(term => {
      return (asset.id || "").toLowerCase().includes(term) ||
             (asset.name || "").toLowerCase().includes(term) ||
             (asset.owner || "").toLowerCase().includes(term) ||
             (asset.category || "").toLowerCase().includes(term) ||
             (asset.condition || "").toLowerCase().includes(term);
    });

    return categoryMatch && statusMatch && searchMatch;
  });

  const counterEl = document.getElementById("results-counter");
  if (counterEl) {
    counterEl.textContent = t("showing_results", { count: filtered.length, total: assets.length });
  }

  const emptyState = document.getElementById("empty-state");
  if (filtered.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    grid.style.display = "none";
    return;
  } else {
    if (emptyState) emptyState.style.display = "none";
    grid.style.display = "grid";
  }

  filtered.forEach((asset, index) => {
    const card = document.createElement("div");
    card.className = "asset-card";
    card.style.animationDelay = `${index * 0.05}s`;
    
    let statusClass = asset.status.toLowerCase().replace(" ", "-");
    let statusKey = `status_${asset.status.toLowerCase().replace(" ", "_")}`;

    // Category Icons Map
    let categoryIcon = "fa-laptop";
    const cat = asset.category.toLowerCase().replace(/[-\s]+/g, "_");
    
    const iconMap = {
      laptop: "fa-laptop",
      tablet: "fa-tablet-screen-button",
      phone: "fa-mobile-screen-button",
      monitor: "fa-desktop",
      computer: "fa-desktop",
      projector: "fa-video",
      digital_signage: "fa-tv",
      printer: "fa-print",
      charger: "fa-plug",
      av_cart: "fa-truck-ramp-box",
      mixing_console: "fa-sliders",
      microphone: "fa-microphone",
      receiver: "fa-radio",
      laptop_storage_cart: "fa-cart-shopping",
      scanner: "fa-print",
      video_conferencing_kit: "fa-chalkboard-user",
      jamboard: "fa-chalkboard",
      speakermic: "fa-volume-high",
      drive_external: "fa-hard-drive",
      camera: "fa-camera",
      projection_screen: "fa-display",
      sensor: "fa-microchip",
      speaker: "fa-volume-up",
      mobile_hotspot: "fa-wifi",
      transducer: "fa-wave-square",
      ups: "fa-battery-three-quarters",
      time_clock: "fa-clock",
      pos_devices: "fa-credit-card",
      security_key: "fa-key",
      operating_system: "fa-window-maximize",
      software: "fa-floppy-disk",
      other: "fa-box-archive"
    };

    if (iconMap[cat]) {
      categoryIcon = iconMap[cat];
    } else if (cat.includes("drive")) {
      categoryIcon = "fa-hard-drive";
    } else if (cat.includes("projection")) {
      categoryIcon = "fa-display";
    } else if (cat.includes("hotspot")) {
      categoryIcon = "fa-wifi";
    }

    card.innerHTML = `
      <div class="asset-card-header">
        <span class="asset-id-tag">${escapeHTML(asset.id)}</span>
        <span class="status-badge ${statusClass}">${t(statusKey)}</span>
      </div>
      <h3 class="asset-title">${escapeHTML(asset.name)}</h3>
      <div class="asset-meta">
        <div class="meta-item">
          <i class="fa-solid ${categoryIcon}"></i>
          <span>${t(asset.category.toLowerCase().replace(/[-\s]+/g, "_"))}</span>
        </div>
        <div class="meta-item">
          <i class="fa-solid fa-user"></i>
          <span>${asset.owner ? escapeHTML(asset.owner) : "---"}</span>
        </div>
      </div>
    `;
    
    card.onclick = () => openDetailsModal(asset.id);
    grid.appendChild(card);
  });
}

// User Profile & Directory Logic
function openPeopleDirectory() {
  renderPeopleList();
  openModal("people-directory-modal");
}

function renderPeopleList() {
  const peopleList = document.getElementById("people-list");
  const searchInput = document.getElementById("people-search-input");
  const filter = searchInput ? searchInput.value.toLowerCase().trim() : "";
  
  peopleList.innerHTML = "";
  
  // Find all unique owners
  const ownersSet = new Set();
  assets.forEach(a => {
    if (a.owner) ownersSet.add(a.owner);
  });
  
  const owners = Array.from(ownersSet).filter(owner => 
    !filter || owner.toLowerCase().includes(filter)
  ).sort();
  
  if (owners.length === 0) {
    peopleList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">${t("no_assets_owned")}</div>`;
  } else {
    owners.forEach(owner => {
      const userAssets = assets.filter(a => a.owner === owner);
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary";
      btn.style.justifyContent = "space-between";
      btn.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
          <i class="fa-solid fa-user-circle" style="font-size: 18px; color: var(--accent-purple);"></i>
          <span>${escapeHTML(owner)}</span>
        </div>
        <span class="status-badge owned" style="font-size: 10px;">${userAssets.length}</span>
      `;
      btn.onclick = () => {
        closeModal("people-directory-modal");
        openUserProfile(owner);
      };
      peopleList.appendChild(btn);
    });
  }
}

function openUserProfile(userName) {
  const userAssets = assets.filter(a => a.owner === userName);
  
  document.getElementById("user-profile-name").textContent = userName;
  document.getElementById("user-profile-stats").textContent = `${userAssets.length} Assets Owned`;
  
  const container = document.getElementById("user-assets-list");
  container.innerHTML = "";
  
  userAssets.forEach(asset => {
    const item = document.createElement("div");
    item.className = "user-asset-item";
    item.innerHTML = `
      <div class="user-asset-info">
        <span class="user-asset-tag">${escapeHTML(asset.id)}</span>
        <span class="user-asset-model">${escapeHTML(asset.name)}</span>
        <span class="user-asset-category">${t(asset.category.toLowerCase())}</span>
      </div>
      <button class="btn btn-secondary btn-sm" style="min-height: 36px; padding: 0 12px; font-size: 12px;">
        ${t("view_details")}
      </button>
    `;
    item.querySelector("button").onclick = () => {
      closeModal("user-profile-modal");
      openDetailsModal(asset.id);
    };
    container.appendChild(item);
  });
  
  // Set up Bulk Return button
  const bulkBtn = document.getElementById("bulk-return-btn");
  bulkBtn.onclick = () => {
    if (confirm(t("confirm_bulk_return", { count: userAssets.length, user: userName }))) {
      bulkReturnAssets(userName);
    }
  };
  
  openModal("user-profile-modal");
}

function bulkReturnAssets(userName) {
  const userAssets = assets.filter(a => a.owner === userName);
  const timestamp = new Date().toISOString();
  
  userAssets.forEach(asset => {
    // Log distinct history event
    asset.history.push({
      timestamp,
      typeKey: "history_type_checkin",
      descKey: "history_checked_in",
      params: { 
        owner: userName, 
        condition: asset.condition,
        note: "Bulk return" 
      }
    });
    
    // Update state
    asset.status = "Open";
    asset.owner = "";
  });
  
  saveState();
  updateMetrics();
  renderAssetList();
  closeModal("user-profile-modal");
  showToast(t("notif_saved"), "success");
}

// Open Detail/Action Modal
function openDetailsModal(assetId) {
  const asset = assets.find(a => (a.id || "").toLowerCase() === assetId.toLowerCase());
  if (!asset) {
    showToast(t("notif_not_found"), "error");
    return;
  }

  // Set Title
  document.getElementById("details-modal-title").textContent = asset.id;

  // Overview Tab Fields
  document.getElementById("view-name").textContent = asset.name;
  document.getElementById("view-category").textContent = t(asset.category.toLowerCase().replace(/[-\s]+/g, "_"));
  document.getElementById("view-serial").textContent = asset.serialNumber || "--";
  document.getElementById("view-location").textContent = asset.location || "--";
  document.getElementById("view-condition").textContent = asset.condition;

  // Status badge setup
  const statusBadge = document.getElementById("view-status-badge");
  const statusSlug = asset.status.toLowerCase().replace(" ", "-");
  statusBadge.className = `status-badge ${statusSlug}`;
  statusBadge.textContent = t(`status_${asset.status.toLowerCase().replace(" ", "_")}`);
  
  // Owner setup
  const ownerText = document.getElementById("view-owner-text");
  if (asset.status === "Owned") {
    ownerText.textContent = `${t("owner")}: ${asset.owner}`;
  } else if (asset.status === "Open") {
    ownerText.textContent = t("status_open");
  } else {
    ownerText.textContent = `${t("owner")}: ${asset.owner || "---"} (${t("status_not_working")})`;
  }

  // Populate Specs List
  const specsList = document.getElementById("view-specs-list");
  specsList.innerHTML = "";
  if (asset.specs && Object.keys(asset.specs).length > 0) {
    for (const [key, value] of Object.entries(asset.specs)) {
      const formattedKey = key.charAt(0).toUpperCase() + key.slice(1);
      const div = document.createElement("div");
      div.className = "spec-item";
      div.innerHTML = `<span class="spec-key">${escapeHTML(formattedKey)}</span><span class="spec-val">${escapeHTML(value)}</span>`;
      specsList.appendChild(div);
    }
  } else {
    specsList.innerHTML = `<span style="color: var(--text-muted); font-size:12px;">---</span>`;
  }
  
  // Acquisition Date
  if (asset.acquisitionDate) {
    const acqDiv = document.createElement("div");
    acqDiv.className = "spec-item";
    acqDiv.innerHTML = `<span class="spec-key">${t("acquisition_date")}</span><span class="spec-val">${escapeHTML(asset.acquisitionDate)}</span>`;
    specsList.appendChild(acqDiv);
  }

  // Tab Content 2 (Edit Form) setup
  document.getElementById("edit-asset-id").value = asset.id;
  document.getElementById("edit-status").value = asset.status;
  document.getElementById("edit-owner").value = asset.owner;
  document.getElementById("edit-location").value = asset.location;
  
  // Reset error displays
  document.getElementById("error-edit-owner").classList.remove("active");
  document.getElementById("error-edit-issue").classList.remove("active");

  const condNormal = document.getElementById("edit-condition-normal");
  const condNotWorking = document.getElementById("edit-condition-notworking");
  
  if (asset.status === "Not Working") {
    condNotWorking.value = asset.condition;
    condNormal.value = "";
  } else {
    condNormal.value = asset.condition;
    condNotWorking.value = "";
  }

  toggleEditStatusFields(asset.status);

  // Tab Content 3 (History Timeline)
  renderHistoryTimeline(asset.history, "view-history-timeline");

  // Tab Content 4 (QR Code Generator)
  generateQRTag(asset.id);

  // Reset tab focus to "Overview"
  switchDetailTab("overview");

  // Show Modal
  openModal("details-modal");
}

// Enforce Form UI adjustments based on status
function toggleEditStatusFields(status) {
  const ownerGroup = document.getElementById("edit-owner-group");
  const issueGroup = document.getElementById("edit-issue-group");
  const normalGroup = document.getElementById("edit-condition-normal-group");

  if (status === "Owned") {
    ownerGroup.style.display = "block";
    issueGroup.style.display = "none";
    normalGroup.style.display = "block";
  } else if (status === "Not Working") {
    ownerGroup.style.display = "block";
    issueGroup.style.display = "block";
    normalGroup.style.display = "none";
  } else {
    ownerGroup.style.display = "none";
    issueGroup.style.display = "none";
    normalGroup.style.display = "block";
  }
}

// Render History Timeline (Generic with Year Headers)
function renderHistoryTimeline(historyList, containerId = "detail-history-timeline", showAssetInfo = false) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!historyList || historyList.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size:13px; text-align:center;">---</div>`;
    return;
  }

  const sorted = [...historyList].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  let lastYear = null;

  sorted.forEach(item => {
    const date = new Date(item.timestamp);
    const year = date.getFullYear();
    
    // Insert Year Header if year changed
    if (year !== lastYear) {
      const yearHeader = document.createElement("div");
      yearHeader.className = "timeline-year-header";
      yearHeader.textContent = year;
      container.appendChild(yearHeader);
      lastYear = year;
    }

    const div = document.createElement("div");
    
    // Determine icon and color based on type
    let icon = "•";
    let typeClass = "event";
    
    if (item.typeKey) {
      if (item.typeKey === "history_type_checkout") {
        icon = "📤";
        typeClass = "checkout";
      } else if (item.typeKey === "history_type_checkin") {
        icon = "📥";
        typeClass = "checkin";
      } else if (item.typeKey === "history_type_transfer") {
        icon = "🔄";
        typeClass = "transfer";
      } else if (item.typeKey === "history_type_created") {
        icon = "✨";
        typeClass = "created";
      } else if (item.typeKey === "history_type_status") {
        icon = "⚙️";
        typeClass = "status-change";
      }
    }
    
    div.className = `timeline-item ${typeClass}`;
    
    // Localized Date formatting
    const dateStr = date.toLocaleString(currentLanguage, { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    // Handle structured vs legacy history
    const description = item.descKey ? t(item.descKey, item.params || {}) : item.description;
    const typeTitle = item.typeKey ? t(item.typeKey) : (item.type || "Event");
    
    const assetContext = showAssetInfo ? `<div class="timeline-asset-id"><strong>[${escapeHTML(item.assetId)}]</strong> ${escapeHTML(item.assetName)}</div>` : "";

    div.innerHTML = `
      <div class="timeline-time">${dateStr}</div>
      <div class="timeline-title">${icon} ${escapeHTML(typeTitle)}</div>
      ${assetContext}
      <div class="timeline-desc">${escapeHTML(description)}</div>
    `;
    container.appendChild(div);
  });
}

// Global History Aggregation & Rendering
function renderGlobalHistory() {
  const categoryFilter = document.getElementById("global-history-category-filter").value;
  const yearFilter = document.getElementById("global-history-year-filter").value;
  const searchQuery = document.getElementById("global-history-search").value.toLowerCase().trim();

  // Aggregate and Enrich
  let globalEntries = [];
  assets.forEach(asset => {
    // Category filter
    if (categoryFilter !== "All" && asset.category !== categoryFilter) return;

    asset.history.forEach(entry => {
      const year = new Date(entry.timestamp).getFullYear().toString();
      
      // Year filter
      if (yearFilter !== "All" && year !== yearFilter) return;

      globalEntries.push({
        ...entry,
        assetId: asset.id,
        assetName: asset.name,
        assetCategory: asset.category
      });
    });
  });

  // Search filter
  if (searchQuery) {
    globalEntries = globalEntries.filter(entry => {
      const desc = entry.descKey ? t(entry.descKey, entry.params || {}).toLowerCase() : (entry.description || "").toLowerCase();
      return entry.assetId.toLowerCase().includes(searchQuery) || 
             entry.assetName.toLowerCase().includes(searchQuery) ||
             desc.includes(searchQuery);
    });
  }

  // Sort by timestamp
  globalEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Cap at 100 entries for performance
  const displayEntries = globalEntries.slice(0, 100);

  renderHistoryTimeline(displayEntries, "global-history-timeline", true);
}

// Dynamically populate year filter based on data
function populateYearFilter() {
  const yearSet = new Set();
  assets.forEach(asset => {
    asset.history.forEach(entry => {
      const year = new Date(entry.timestamp).getFullYear();
      if (year) yearSet.add(year);
    });
  });

  const filter = document.getElementById("global-history-year-filter");
  if (!filter) return;

  const currentVal = filter.value;
  filter.innerHTML = `<option value="All" data-i18n="all_years">${t("all_years")}</option>`;
  
  Array.from(yearSet).sort((a, b) => b - a).forEach(year => {
    const option = document.createElement("option");
    option.value = year.toString();
    option.textContent = year.toString();
    filter.appendChild(option);
  });

  filter.value = currentVal || "All";
}

// Generate QR Code dynamically
function generateQRTag(assetId) {
  const container = document.getElementById("asset-qr-code-container");
  container.innerHTML = "";
  
  try {
    new QRCode(container, {
      text: assetId,
      width: 160,
      height: 160,
      colorDark: "#0c111d",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  } catch (e) {
    console.error("QR Code generation failed", e);
    container.innerHTML = `<span style="color: var(--status-error);">Error</span>`;
  }
}

// Switch detail panel tabs
function switchDetailTab(tabId) {
  document.querySelectorAll(".detail-tab").forEach(tab => {
    tab.classList.toggle("active", tab.getAttribute("data-tab") === tabId);
  });

  document.querySelectorAll(".detail-pane").forEach(pane => {
    pane.classList.toggle("active", pane.id === `detail-pane-${tabId}`);
  });
}
// Setup Event Listeners
function setupEventListeners() {
  // Export Data
  on("export-data-btn", "click", () => {
    const dataStr = JSON.stringify(assets, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `asset_backup_${new Date().toISOString().split("T")[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Backup downloaded successfully!", "success");
  });

  // Clear All Data
  on("clear-all-data-btn", "click", () => {
    if (confirm(t("confirm_clear_all"))) {
      assets = [];
      saveState();
      updateMetrics();
      renderAssetList();
      closeModal("global-history-modal");
      showToast(t("notif_saved"), "success");
    }
  });

  // Language Toggles
  const langToggle = document.getElementById("lang-toggle-btn");
  if (langToggle) {
    langToggle.addEventListener("click", () => {
      currentLanguage = currentLanguage === "en" ? "es" : "en";
      applyTranslations(currentLanguage);
    });
  }

  // Category tabs click
  on("category-tabs", "click", (e) => {
    if (e.target.classList.contains("tab-btn")) {
      document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
      e.target.classList.add("active");
      
      // Reset the "More Categories..." select box
      const moreSelect = document.getElementById("more-categories-select");
      if (moreSelect) moreSelect.value = "";
      
      activeCategory = e.target.getAttribute("data-category");
      renderAssetList();
    }
  });

  // More Categories dropdown selection
  on("more-categories-select", "change", (e) => {
    const selectedCategory = e.target.value;
    if (!selectedCategory) return; // Ignore placeholder option selection
    
    // Deselect all quick chips
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    
    activeCategory = selectedCategory;
    renderAssetList();
  });

  // Status filters click
  on("status-filters", "click", (e) => {
    if (e.target.classList.contains("filter-chip")) {
      document.querySelectorAll(".filter-chip").forEach(btn => btn.classList.remove("active"));
      e.target.classList.add("active");
      activeStatus = e.target.getAttribute("data-status");
      renderAssetList();
    }
  });

  // Metric Card Clicks for Quick Filter
  onSelector(".metric-card.open-metric", "click", () => {
    const chip = document.querySelector('.filter-chip[data-status="Open"]');
    if (chip) chip.click();
  });
  onSelector(".metric-card.owned-metric", "click", () => {
    const chip = document.querySelector('.filter-chip[data-status="Owned"]');
    if (chip) chip.click();
  });
  onSelector(".metric-card.broken-metric", "click", () => {
    const chip = document.querySelector('.filter-chip[data-status="Not Working"]');
    if (chip) chip.click();
  });

  // Search input change
  on("asset-search-input", "input", (e) => {
    searchQuery = e.target.value;
    renderAssetList();
  });

  // Add Asset
  on("add-asset-btn", "click", () => {
    openModal("add-asset-modal");
  });

  on("add-asset-close-btn", "click", () => {
    closeModal("add-asset-modal");
  });

  // Sync Atlassian
  on("sync-atlassian-btn", "click", () => {
    syncWithAtlassian();
  });

  // Settings
  on("settings-btn", "click", () => {
    openModal("settings-modal");
  });

  // Magic URL Sniffer (Global Paste Listener for Settings)
  on("settings-modal", "paste", (e) => {
    const url = (e.clipboardData || window.clipboardData).getData('text').trim();
    if (!url || !url.includes("atlassian.net")) return; 
    
    // Helper to clean IDs
    const clean = (id) => id ? id.replace(/[^a-z0-9-]/gi, "").trim() : "";

    // 1. Try to find Workspace ID (Object Schema ID) using multiple pattern fallbacks
    let workspaceId = "";
    
    // Pattern A: /object-schema/[ID]
    const schemaMatch = url.match(/\/object-schema\/([a-z0-9-]+)/i);
    // Pattern B: /objects/[ID] or /assets/[ID]
    const objectsMatch = url.match(/\/objects?\/([a-z0-9-]+)/i);
    // Pattern C: ?workspaceId=[ID] or &workspaceId=[ID]
    const queryMatch = url.match(/[?&]workspaceId=([a-z0-9-]+)/i);
    // Pattern D: /assets/([a-z0-9-]+) (simple folder match)
    const simpleMatch = url.match(/\/assets\/([a-z0-9-]+)/i);

    if (schemaMatch) {
      workspaceId = clean(schemaMatch[1]);
    } else if (objectsMatch) {
      workspaceId = clean(objectsMatch[1]);
    } else if (queryMatch) {
      workspaceId = clean(queryMatch[1]);
    } else if (simpleMatch) {
      const parsed = clean(simpleMatch[1]);
      // Avoid matching common folders as IDs
      if (!["object-schema", "objects", "object", "schema"].includes(parsed)) {
        workspaceId = parsed;
      }
    }

    // Write Workspace ID to input
    if (workspaceId) {
      document.getElementById("api-workspace-id").value = workspaceId;
      apiConfig.workspaceId = workspaceId;
    }

    // 2. Try to find Cloud ID / Subdomain
    const domainMatch = url.match(/https?:\/\/([a-z0-9-]+)\.atlassian\.net/i);
    if (domainMatch) {
       const sub = domainMatch[1].toLowerCase();
       if (!["jira", "admin", "id", "assets"].includes(sub)) {
         document.getElementById("api-cloud-id").value = clean(sub);
         apiConfig.cloudId = sub;
         
         // Background resolver to get the real long Cloud ID
         showToast("Resolving Atlassian Cloud ID...", "info");
         fetch(`https://${sub}.atlassian.net/metadata/properties/id`)
           .then(res => res.json())
           .then(meta => {
             if (meta && meta.id) {
               document.getElementById("api-cloud-id").value = meta.id;
               apiConfig.cloudId = meta.id;
               saveState();
               showToast("Cloud ID resolved successfully!", "success");
             }
           })
           .catch(err => {
             console.log("Background ID resolver failed:", err);
             showToast("Workspace ID loaded. Subdomain saved as fallback.", "info");
           });
       }
    }
    
    saveState();
  });

  on("people-directory-trigger-btn", "click", () => {
    openPeopleDirectory();
  });

  on("settings-help-btn", "click", () => {
    const helpSection = document.getElementById("settings-help-section");
    helpSection.style.display = helpSection.style.display === "none" ? "block" : "none";
  });

  on("close-help-btn", "click", () => {
    document.getElementById("settings-help-section").style.display = "none";
  });

  on("settings-close-btn", "click", () => {
    closeModal("settings-modal");
    document.getElementById("settings-help-section").style.display = "none"; // Reset for next time
  });

  on("settings-form", "submit", (e) => {
    e.preventDefault();
    apiConfig = {
      cloudId: document.getElementById("api-cloud-id").value,
      workspaceId: document.getElementById("api-workspace-id").value,
      email: document.getElementById("api-email").value,
      token: document.getElementById("api-token").value
    };
    saveState();
    closeModal("settings-modal");
    showToast(t("notif_config_saved"), "success");
  });

  on("clear-config-btn", "click", () => {
    if (confirm(t("confirm_clear_all"))) { 
      apiConfig = { cloudId: "", workspaceId: "", email: "", token: "" };
      saveState();
      // Force UI update
      document.getElementById("api-cloud-id").value = "";
      document.getElementById("api-workspace-id").value = "";
      document.getElementById("api-email").value = "";
      document.getElementById("api-token").value = "";
      showToast(t("notif_config_cleared"), "info");
    }
  });

  // Global History
  on("global-history-btn", "click", () => {
    renderGlobalHistory();
    openModal("global-history-modal");
  });

  on("global-history-close-btn", "click", () => {
    closeModal("global-history-modal");
  });

  // Scan QR
  on("scan-qr-btn", "click", () => {
    openModal("scanner-modal");
    startCameraScanner();
  });

  on("scanner-close-btn", "click", () => {
    stopCameraScanner();
    closeModal("scanner-modal");
  });
  
  on("floating-help-btn", "click", () => {
    openModal("app-guide-modal");
  });

  on("guide-close-btn", "click", () => {
    closeModal("app-guide-modal");
  });

  on("guide-got-it-btn", "click", () => {
    closeModal("app-guide-modal");
  });

  on("global-history-trigger-btn", "click", () => {
    openModal("global-history-modal");
    populateYearFilter();
    renderGlobalHistory();
  });

  // Modal close buttons
  on("scanner-close-btn", "click", () => {
    closeModal("scanner-modal");
    stopCameraScanner();
  });

  on("details-close-btn", "click", () => {
    closeModal("details-modal");
  });

  on("people-directory-close-btn", "click", () => {
    closeModal("people-directory-modal");
  });
  
  on("user-profile-close-btn", "click", () => {
    closeModal("user-profile-modal");
  });

  // Click overlay to close
  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) {
      closeModal(e.target.id);
      if (e.target.id === "scanner-modal") {
        stopCameraScanner();
      }
    }
  });

  // Detail Modal tab buttons click
  onSelector(".detail-tabs", "click", (e) => {
    if (e.target.classList.contains("detail-tab")) {
      switchDetailTab(e.target.getAttribute("data-tab"));
    }
  });

  // Enforce Form UI changes based on status
  on("edit-status", "change", (e) => {
    toggleEditStatusFields(e.target.value);
  });

  // People Search Filter
  on("people-search-input", "input", renderPeopleList);

  // Main Header Search Go Button Logic
  on("main-search-go-btn", "click", () => {
    const inputVal = document.getElementById("asset-search-input").value.trim();
    if (!inputVal) return;

    // Normalize input (e.g. M2379 -> smm2379)
    let normalizedId = inputVal.toLowerCase();
    if (normalizedId.startsWith("m") && normalizedId.length > 2) {
      normalizedId = "smm" + normalizedId.substring(1);
    }

    const existing = assets.find(a => a.id === normalizedId || a.serialNumber === normalizedId || a.id === inputVal);
    if (existing) {
      openDetailsModal(existing.id);
      document.getElementById("asset-search-input").value = ""; // Clean input on success
    } else {
      showToast(t("notif_not_found"), "error");
    }
  });
  
  // Theme Toggle Logic
  on("theme-toggle-btn", "click", () => {
    const themeBtn = document.getElementById("theme-toggle-btn");
    if (document.body.getAttribute("data-theme") === "dark") {
      document.body.removeAttribute("data-theme");
      localStorage.setItem("assetGuard_theme", "light");
      themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    } else {
      document.body.setAttribute("data-theme", "dark");
      localStorage.setItem("assetGuard_theme", "dark");
      themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    }
  });

  // Global History Filters
  on("global-history-category-filter", "change", renderGlobalHistory);
  on("global-history-year-filter", "change", renderGlobalHistory);
  on("global-history-search", "input", renderGlobalHistory);

  // Submit edits form
  on("edit-asset-form", "submit", (e) => {
    e.preventDefault();
    const assetId = document.getElementById("edit-asset-id").value;
    const newStatus = document.getElementById("edit-status").value;
    const newOwner = document.getElementById("edit-owner").value.trim();
    const newLocation = document.getElementById("edit-location").value.trim();
    
    // Clear errors
    document.getElementById("error-edit-owner").classList.remove("active");
    document.getElementById("error-edit-issue").classList.remove("active");

    const asset = assets.find(a => a.id === assetId);
    if (!asset) return;

    // Apply strict validation rules
    if (newStatus === "Owned" && !newOwner) {
      document.getElementById("error-edit-owner").classList.add("active");
      showToast("Owner name is required", "error");
      return;
    }

    let finalCondition = "";
    if (newStatus === "Not Working") {
      const issue = document.getElementById("edit-condition-notworking").value.trim();
      if (!issue) {
        document.getElementById("error-edit-issue").classList.add("active");
        showToast("Issue report is required", "error");
        return;
      }
      finalCondition = issue;
    } else {
      finalCondition = document.getElementById("edit-condition-normal").value.trim() || "Healthy";
    }

    const timestamp = new Date().toISOString();

    // Check handover types
    if (asset.status === "Open" && newStatus === "Owned") {
      // Checkout
      asset.history.push({
        timestamp,
        typeKey: "history_type_checkout",
        descKey: "history_checked_out",
        params: { owner: newOwner, condition: finalCondition }
      });
    } else if (asset.status === "Owned" && (newStatus === "Open" || newStatus === "Not Working")) {
      // Check-in
      asset.history.push({
        timestamp,
        typeKey: "history_type_checkin",
        descKey: "history_checked_in",
        params: { owner: asset.owner, condition: finalCondition }
      });
    } else if (asset.status === "Owned" && newStatus === "Owned" && asset.owner !== newOwner) {
      // Transfer
      asset.history.push({
        timestamp,
        typeKey: "history_type_transfer",
        descKey: "history_transferred",
        params: { oldOwner: asset.owner, newOwner: newOwner, condition: finalCondition }
      });
    } else if (asset.status !== newStatus) {
      // Generic status change
      asset.history.push({
        timestamp,
        typeKey: "history_type_status",
        descKey: "history_status_change",
        params: { status: `status_${newStatus.toLowerCase().replace(" ", "_")}` }
      });
    }

    // Apply updates to state
    asset.status = newStatus;
    asset.owner = newStatus === "Open" ? "" : newOwner;
    asset.location = newLocation || asset.location;
    asset.condition = finalCondition;
    
    saveState();
    updateMetrics();
    renderAssetList();
    
    closeModal("details-modal");
    showToast(t("notif_saved"), "success");
  });

  // Defensive helper to attach listeners
  function on(id, event, callback) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, callback);
  }

  // Defensive helper for selectors
  function onSelector(selector, event, callback) {
    const el = document.querySelector(selector);
    if (el) el.addEventListener(event, callback);
  }

  // Submit add new asset form
  on("add-asset-form", "submit", (e) => {
    e.preventDefault();
    const addId = document.getElementById("add-id").value.trim().toUpperCase();
    const addName = document.getElementById("add-name").value.trim();
    const addCategory = document.getElementById("add-category").value;
    const addSerial = document.getElementById("add-serial").value.trim();
    const addLocation = document.getElementById("add-location").value.trim();
    const addCondition = document.getElementById("add-condition").value.trim();
    const addAcqDate = document.getElementById("add-acquisition-date").value;
    
    const specCpu = document.getElementById("add-spec-cpu").value.trim();
    const specRam = document.getElementById("add-spec-ram").value.trim();
    const specStorage = document.getElementById("add-spec-storage").value.trim();
    const specOs = document.getElementById("add-spec-os").value.trim();

    // Check duplicate
    document.getElementById("error-add-id-exists").classList.remove("active");
    if (assets.some(a => a.id === addId)) {
      document.getElementById("error-add-id-exists").classList.add("active");
      showToast("ID already exists", "error");
      return;
    }
    
    // Future Date validation
    if (addAcqDate && new Date(addAcqDate) > new Date()) {
      showToast("Acquisition date cannot be in the future", "error");
      return;
    }

    // Assemble Specs object (consistent with seeds)
    const specs = {};
    if (specCpu) specs.cpu = specCpu;
    if (specRam) specs.ram = specRam;
    if (specStorage) specs.storage = specStorage;
    if (specOs) specs.os = specOs;

    // Assemble New Asset
    const newAsset = {
      id: addId,
      name: addName,
      category: addCategory,
      serialNumber: addSerial,
      status: "Open",
      owner: "",
      location: addLocation,
      condition: addCondition,
      acquisitionDate: addAcqDate,
      specs: specs,
      history: [
        {
          timestamp: new Date().toISOString(),
          typeKey: "history_type_created",
          descKey: "history_added",
          params: {}
        }
      ]
    };

    // Save and Render
    assets.push(newAsset);
    saveState();
    updateMetrics();
    renderAssetList();
    
    // Reset Form & Close Modal
    document.getElementById("add-asset-form").reset();
    closeModal("add-asset-modal");
    showToast(t("notif_saved"), "success");
  });

  // Manual Scan Entry Logic
  on("manual-scan-btn", "click", () => {
    const manualInput = document.getElementById("manual-scan-input").value.trim();
    if (!manualInput) return;
    
    // Normalize manual input (e.g. M2379 -> smm2379)
    let normalizedId = manualInput.toLowerCase();
    if (normalizedId.startsWith("m") && normalizedId.length > 2) {
      normalizedId = "smm" + normalizedId.substring(1);
    }
    
    const existing = assets.find(a => {
      const assetIdLower = (a.id || "").toLowerCase();
      const assetSerialLower = (a.serialNumber || "").toLowerCase();
      return assetIdLower === normalizedId || 
             assetSerialLower === normalizedId || 
             assetIdLower === manualInput.toLowerCase();
    });
    
    // Close scanner first
    stopCameraScanner();
    closeModal("scanner-modal");
    document.getElementById("manual-scan-input").value = "";

    if (existing) {
      // If the laptop exists, open the details modal directly!
      showToast(t("notif_scan_success", { id: normalizedId }), "success");
      openDetailsModal(existing.id);
    } else {
      // Only open the Add screen if the laptop is new
      showToast(t("notif_new_asset_scanned"), "info");
      openModal("add-asset-modal");
      document.getElementById("add-id").value = normalizedId;
    }
  });
}

// Start Camera Stream QR scan
function startCameraScanner() {
  if (isScannerStarting) return;
  isScannerStarting = true;
  shouldStopScanner = false;
  
  document.getElementById("scanner-output-status").textContent = "...";
  
  if (html5QrScanner) {
    try {
      const clearResult = html5QrScanner.clear();
      if (clearResult && typeof clearResult.catch === 'function') {
        clearResult.catch(e => console.log("Clear error", e));
      }
    } catch (e) {
      console.log("Clear error", e);
    }
  }

  html5QrScanner = new Html5Qrcode("qr-reader");
  const config = { fps: 15, qrbox: { width: 300, height: 300 } };

  html5QrScanner.start(
    { facingMode: "environment" }, 
    config,
    (decodedText) => {
      playBeep();
      stopCameraScanner();
      closeModal("scanner-modal");

      // Normalize scanned text (e.g. M2379 -> smm2379)
      let normalizedId = decodedText.trim().toLowerCase();
      if (normalizedId.startsWith("m") && normalizedId.length > 2) {
        normalizedId = "smm" + normalizedId.substring(1);
      }

      const existing = assets.find(a => {
        const assetIdLower = (a.id || "").toLowerCase();
        const assetSerialLower = (a.serialNumber || "").toLowerCase();
        return assetIdLower === normalizedId || 
               assetSerialLower === normalizedId || 
               assetIdLower === decodedText.toLowerCase();
      });
      if (existing) {
        showToast(t("notif_scan_success", { id: normalizedId }), "success");
        openDetailsModal(existing.id);
      } else {
        // New asset found! Open the Add Modal
        showToast(t("notif_new_asset_scanned"), "info");
        openModal("add-modal");
        document.getElementById("add-id").value = normalizedId;
        // Optionally pre-fill serial if it looks like one
        if (decodedText.length > 5) {
          document.getElementById("add-serial").value = decodedText;
        }
      }
    },
    (errorMessage) => {
    }
  ).then(() => {
    isScannerStarting = false;
    if (shouldStopScanner) {
      stopCameraScanner();
    } else {
      document.getElementById("scanner-output-status").textContent = "";
    }
  }).catch(err => {
    isScannerStarting = false;
    console.error("Camera startup failure", err);
    document.getElementById("scanner-output-status").textContent = "Camera error: Camera not found or permission denied.";
    setTimeout(() => {
      closeModal("scanner-modal");
      isScannerStarting = false; // Reset flag so they can try again
    }, 3000); 
  });
}


// Stop Camera Stream
function stopCameraScanner() {
  if (isScannerStarting) {
    shouldStopScanner = true;
    return;
  }
  
  if (html5QrScanner) {
    try {
      html5QrScanner.stop().then(() => {
        if (html5QrScanner) {
          try {
            const clearResult = html5QrScanner.clear();
            if (clearResult && typeof clearResult.catch === 'function') {
              clearResult.catch(e => console.log("Clear error", e));
            }
          } catch (e) {
            console.log("Clear error", e);
          }
        }
      }).catch(err => console.error("Scanner stop fail", err));
    } catch (e) {
      console.log("Scanner already stopped or clear failed", e);
    }
  }
}

// General Modal open/close helpers
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
    if (modalId === "settings-modal") {
      document.getElementById("api-cloud-id").value = apiConfig.cloudId || "";
      document.getElementById("api-workspace-id").value = apiConfig.workspaceId || "";
      document.getElementById("api-email").value = apiConfig.email || "";
      document.getElementById("api-token").value = apiConfig.token || "";
    }
  }
}
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("active");
}

// Theme Toggle Initial State Loader
document.addEventListener("DOMContentLoaded", () => {
  const themeBtn = document.getElementById("theme-toggle-btn");
  if (!themeBtn) return;
  
  const currentTheme = localStorage.getItem("assetGuard_theme") || "light";
  if (currentTheme === "dark") {
    document.body.setAttribute("data-theme", "dark");
    themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
  } else {
    document.body.removeAttribute("data-theme");
    themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
  }
});
