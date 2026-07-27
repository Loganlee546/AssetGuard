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
let currentPage = 1;
let assetsPerPage = 50; // Dynamic client-side layout pagination (default 50 per page!)
let isScannerStarting = false;
let shouldStopScanner = false;
let currentLanguage = localStorage.getItem("assetGuard_lang") || "en";
// Clean up legacy pre-filled parameters from previous sessions
if (localStorage.getItem("assetGuard_cloud_id") === "smm-sandbox") localStorage.removeItem("assetGuard_cloud_id");
if (localStorage.getItem("assetGuard_workspace_id") === "3") localStorage.removeItem("assetGuard_workspace_id");
if (sessionStorage.getItem("assetGuard_email") === "llee_smm@smm.com") sessionStorage.removeItem("assetGuard_email");
let isOfflineMode = localStorage.getItem("assetGuard_offline_mode") === "true";

let apiConfig = {
  cloudId: localStorage.getItem("assetGuard_cloud_id") || "",
  workspaceId: localStorage.getItem("assetGuard_workspace_id") || "",
  email: sessionStorage.getItem("assetGuard_email") || "",
  token: sessionStorage.getItem("assetGuard_token") || "",
  syncLimit: parseInt(localStorage.getItem("assetGuard_sync_limit")) || 100
};
let atlassianBaseUrl = sessionStorage.getItem("assetGuard_base_url") || "";

// State persistence
function saveState() {
  localStorage.setItem("assetGuard_assets", JSON.stringify(assets));
  localStorage.setItem("assetGuard_lang", currentLanguage);
  localStorage.setItem("assetGuard_offline_mode", isOfflineMode);
  
  // Save non-confidential routing IDs persistently to bypass slow auto-resolution hops
  localStorage.setItem("assetGuard_cloud_id", apiConfig.cloudId);
  localStorage.setItem("assetGuard_workspace_id", apiConfig.workspaceId);
  localStorage.setItem("assetGuard_sync_limit", apiConfig.syncLimit);
  
  // Save highly-confidential credentials in temporary session storage
  sessionStorage.setItem("assetGuard_email", apiConfig.email);
  sessionStorage.setItem("assetGuard_token", apiConfig.token);
}

// Native sessionStorage is already automatically wiped by the browser when the tab or browser is closed.
// Keeping sessionStorage intact on page refreshes ensures a smooth user experience!

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  // Initialize Data from LocalStorage or start empty
  const savedAssets = localStorage.getItem("assetGuard_assets");
  const seeds = window.itAssetSeeds || [];
  
  if (savedAssets) {
    try {
      assets = JSON.parse(savedAssets);
      // Filter out any mock seed devices to get rid of the fake devices permanently
      const seedIds = seeds.map(s => (s.id || "").toLowerCase());
      assets = assets.filter(a => !seedIds.includes((a.id || "").toLowerCase()));
      saveState();
    } catch (e) {
      console.error("Failed to parse local storage assets, resetting.", e);
      assets = [];
      saveState();
    }
  } else {
    // Start with a completely clean database
    assets = [];
    saveState();
  }

  // Initial Render
  updateMetrics();
  renderAssetList();
  applyTranslations(currentLanguage);
  setupEventListeners();
  toggleOfflineUI(isOfflineMode);
});
// Atlassian Connection Status Dashboard and Auto-Resolution Helpers
function isValidUUID(str) {
  if (!str) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str.trim());
}

// Parse smart QR codes containing JSON, URL query parameters, Atlassian URLs, pure numbers, or raw ID strings
function parseScannedContent(text) {
  const result = {
    id: "",
    name: "",
    category: "Laptop",
    serial: "",
    location: "",
    condition: "Healthy",
    cpu: "",
    ram: "",
    storage: "",
    os: ""
  };

  const trimmed = text.trim();
  if (!trimmed) return result;



  // 1. Try JSON
  try {
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const data = JSON.parse(trimmed);
      if (data.id) result.id = String(data.id);
      if (data.name) result.name = String(data.name);
      if (data.category) result.category = String(data.category);
      if (data.serial) result.serial = String(data.serial);
      if (data.serialNumber) result.serial = String(data.serialNumber);
      if (data.location) result.location = String(data.location);
      if (data.condition) result.condition = String(data.condition);
      
      if (data.specs) {
        if (data.specs.cpu) result.cpu = String(data.specs.cpu);
        if (data.specs.ram) result.ram = String(data.specs.ram);
        if (data.specs.storage) result.storage = String(data.specs.storage);
        if (data.specs.os) result.os = String(data.specs.os);
      } else {
        if (data.cpu) result.cpu = String(data.cpu);
        if (data.ram) result.ram = String(data.ram);
        if (data.storage) result.storage = String(data.storage);
        if (data.os) result.os = String(data.os);
      }
      return result;
    }
  } catch (e) {
    console.log("QR parse: Not a JSON string", e);
  }

  // 1.5. Special check: Try to extract Atlassian Assets IDs if it contains .atlassian.net
  if (trimmed.includes(".atlassian.net")) {
    try {
      const urlObj = new URL(trimmed);
      const objId = urlObj.searchParams.get("objectId") || urlObj.searchParams.get("selectedObjectId");
      if (objId) {
        result.id = "smm" + objId;
        result.serial = trimmed;
        return result;
      }
    } catch (e) {
      console.log("QR parse: Atlassian URL parser error", e);
    }
  }

  // 2. Try URL query parameters
  if (trimmed.includes("=") || trimmed.includes("&")) {
    try {
      let queryStr = trimmed;
      if (trimmed.includes("?")) {
        queryStr = trimmed.split("?")[1];
      }
      const params = new URLSearchParams(queryStr);
      
      let matchedAny = false;
      if (params.has("id")) { result.id = params.get("id"); matchedAny = true; }
      if (params.has("name")) { result.name = params.get("name"); matchedAny = true; }
      if (params.has("category")) { result.category = params.get("category"); matchedAny = true; }
      if (params.has("serial")) { result.serial = params.get("serial"); matchedAny = true; }
      if (params.has("serialNumber")) { result.serial = params.get("serialNumber"); matchedAny = true; }
      if (params.has("location")) { result.location = params.get("location"); matchedAny = true; }
      if (params.has("condition")) { result.condition = params.get("condition"); matchedAny = true; }
      if (params.has("cpu")) { result.cpu = params.get("cpu"); matchedAny = true; }
      if (params.has("ram")) { result.ram = params.get("ram"); matchedAny = true; }
      if (params.has("storage")) { result.storage = params.get("storage"); matchedAny = true; }
      if (params.has("os")) { result.os = params.get("os"); matchedAny = true; }
      
      if (matchedAny && result.id) {
        return result;
      }
    } catch (e) {
      console.log("QR parse: Not query parameters", e);
    }
  }

  // 3. Try to sniff if the text is an Atlassian Assets or generic URL containing a numeric ID
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.includes(".atlassian.net") || trimmed.includes("/assets/") || trimmed.includes("/object/")) {
    try {
      // Match patterns like /object/1234, /objects/1234, /assets/1234, /asset/1234 or a trailing /1234
      const objectMatch = trimmed.match(/\/object(?:s)?\/([0-9]+)/i);
      const assetsMatch = trimmed.match(/\/asset(?:s)?\/([0-9]+)/i);
      const trailingMatch = trimmed.match(/\/([0-9]+)(?:[?#]|$)/);

      let numericId = "";
      if (objectMatch) {
        numericId = objectMatch[1];
      } else if (assetsMatch) {
        numericId = assetsMatch[1];
      } else if (trailingMatch) {
        numericId = trailingMatch[1];
      }

      if (numericId) {
        result.id = "smm" + numericId;
        result.serial = trimmed; // Keep full URL as fallback serial
        return result;
      }
    } catch (e) {
      console.log("QR parse: Atlassian ID sniffer exception", e);
    }
  }

  // 4. Try to parse if it is a pure numeric ID (the digits next to the QR code, e.g. "1024" or "0421")
  if (/^[0-9]+$/.test(trimmed) && trimmed.length > 0) {
    result.id = "smm" + trimmed;
    result.serial = trimmed;
    return result;
  }

  // 5. Try to parse "M" prefixed tags (e.g. "M2379" -> "smm2379")
  if (trimmed.toLowerCase().startsWith("m") && /^[0-9]+$/.test(trimmed.substring(1))) {
    result.id = "smm" + trimmed.substring(1);
    result.serial = trimmed;
    return result;
  }

  // 6. Generic plain barcode/raw ID fallback
  result.id = trimmed;
  if (trimmed.length > 5) {
    result.serial = trimmed;
  }
  return result;
}

// Prefills the Add Asset form inputs with a parsed content object
function prefillAddAssetForm(parsed) {
  let normalizedId = parsed.id.trim().toUpperCase();
  if (normalizedId.startsWith("M") && normalizedId.length > 2) {
    normalizedId = "SMM" + normalizedId.substring(1);
  }

  document.getElementById("add-id").value = normalizedId;
  document.getElementById("add-name").value = parsed.name || "";
  document.getElementById("add-category").value = parsed.category || "Laptop";
  document.getElementById("add-serial").value = parsed.serial || "";
  document.getElementById("add-location").value = parsed.location || "";
  document.getElementById("add-condition").value = parsed.condition || "Healthy";
  document.getElementById("add-spec-cpu").value = parsed.cpu || "";
  document.getElementById("add-spec-ram").value = parsed.ram || "";
  document.getElementById("add-spec-storage").value = parsed.storage || "";
  document.getElementById("add-spec-os").value = parsed.os || "";
}

function updateConnectionUI(status, detailsMsg = "") {
  const card = document.getElementById("connection-status-card");
  const badge = document.getElementById("connection-status-badge");
  const details = document.getElementById("connection-status-details");

  if (!card || !badge || !details) return;

  // Clear previous state classes
  card.className = "connection-status-card " + status;
  badge.className = "connection-badge status-" + status;

  // Set translation/text
  if (status === "offline") {
    badge.textContent = "Offline Mode";
  } else {
    badge.textContent = t("conn_status_" + status);
  }

  // Persistence of connection state
  if (status !== "syncing" && status !== "offline") {
    localStorage.setItem("assetGuard_last_sync_status", status);
    if (status === "connected") {
      const timeStr = new Date().toLocaleString();
      localStorage.setItem("assetGuard_last_sync_time", timeStr);
      localStorage.setItem("assetGuard_last_sync_error", "");
    } else if (status === "error") {
      localStorage.setItem("assetGuard_last_sync_error", detailsMsg);
    }
  }

  // Set details content
  if (status === "offline") {
    details.innerHTML = `
      <span style="color: var(--accent-purple); font-weight: 600; display: flex; align-items: center; gap: 6px;">
        <i class="fa-solid fa-plane-slash"></i> Offline Sandbox Mode Active
      </span>
      <p style="margin-top: 4px; font-size: 11.5px; color: var(--text-secondary); line-height: 1.4;">
        The system is running purely in local-storage mode. Live synchronization with Atlassian is disabled, and changes are confined to your browser database.
      </p>
    `;
  } else if (status === "unconfigured") {
    details.innerHTML = `<span>${t("conn_status_details_unconfigured")}</span>`;
  } else if (status === "ready") {
    details.innerHTML = `<span>${t("conn_status_details_ready")}</span>`;
  } else if (status === "syncing") {
    details.innerHTML = `<span style="display: flex; align-items: center; gap: 8px;"><i class="fa-solid fa-spinner fa-spin"></i> ${detailsMsg || t("sync_loading")}</span>`;
  } else if (status === "connected") {
    const count = localStorage.getItem("assetGuard_last_sync_count") || "0";
    const time = localStorage.getItem("assetGuard_last_sync_time") || new Date().toLocaleString();
    details.innerHTML = `<span>${t("conn_status_details_connected", { time, count })}</span>`;
  } else if (status === "error") {
    const isFailedToFetch = detailsMsg.toLowerCase().includes("failed to fetch");
    if (isFailedToFetch) {
      details.innerHTML = `
        <span style="color: var(--status-error); font-weight: 600; display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Browser CORS Block Detected</span>
        <p style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">
          Atlassian Cloud APIs restrict web browsers from making direct requests from external origins (CORS security).
        </p>
        
        <div style="margin-top: 12px; background: var(--bg-body); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
          <div style="font-weight: 600; font-size: 12px; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-lightbulb" style="color: #FFC400;"></i> How to bypass this:
          </div>
          
          <div style="font-size: 11.5px; line-height: 1.4; color: var(--text-secondary);">
            <strong style="color: var(--text-primary);">Option A (Easiest - 10 seconds):</strong> Install a CORS Bypass browser extension:
            <ul style="margin: 6px 0 0 16px; padding: 0; list-style-type: disc;">
              <li>Search & install the extension: <strong>"Allow CORS: Access-Control-Allow-Origin"</strong> for Chrome/Firefox/Edge.</li>
              <li>Turn the extension <strong>ON</strong> (extension icon turns green).</li>
              <li>Click <strong>Sync from Atlassian</strong> again!</li>
            </ul>
          </div>
          
          <div style="font-size: 11.5px; line-height: 1.4; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 8px;">
            <strong style="color: var(--text-primary);">Option B (Manual Inputs):</strong> Find your real UUIDs manually to bypass auto-resolution:
            <ol style="margin: 6px 0 0 16px; padding: 0; list-style-type: decimal;">
              <li>Open your Jira Assets web page in your browser.</li>
              <li>Press <strong>F12</strong> (Developer Tools), go to the <strong>Network</strong> tab.</li>
              <li>Search for <strong>"aql"</strong> or <strong>"workspace"</strong>, and click any completed request.</li>
              <li>Copy the UUIDs from the request URL:
                <ul style="margin-top: 2px; padding-left: 12px; list-style-type: circle;">
                  <li><strong>Workspace ID</strong> is the long UUID after <code style="font-family: monospace; color: var(--accent-blue);">/workspace/</code></li>
                  <li><strong>Cloud ID</strong> is the long UUID after <code style="font-family: monospace; color: var(--accent-blue);">/ex/jira/</code></li>
                </ul>
              </li>
              <li>Enter those UUIDs directly into the fields below to bypass auto-resolution!</li>
            </ol>
          </div>
        </div>
        
        <div class="error-details-block" style="margin-top: 10px;">Original System Error: ${escapeHTML(detailsMsg)}</div>
      `;
    } else if (detailsMsg.includes("404") || detailsMsg.includes("path not found")) {
      const savedSub = localStorage.getItem("assetGuard_subdomain") || "your-site";
      details.innerHTML = `
        <span style="color: var(--status-error); font-weight: 600; display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-circle-xmark"></i> Atlassian Path Not Found (HTTP 404)</span>
        <p style="margin-top: 4px; font-size: 12px; color: var(--text-secondary); line-height: 1.45;">
          Atlassian Cloud returned 404. Here is how to resolve each of the 3 server-side causes in 1 click:
        </p>
        
        <div style="margin-top: 10px; background: var(--bg-body); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
          <!-- Solution for Reason 1: Plan/Licensing -->
          <div style="font-size: 11.5px; line-height: 1.4; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
            <strong style="color: var(--text-primary);"><i class="fa-solid fa-shield-halved" style="color: var(--accent-purple);"></i> Fix Reason 1 (Plan / License):</strong><br/>
            If your site is on Jira Service Management Free/Standard, Assets REST APIs do not exist on Atlassian's servers. You can use instant Batch Import instead:
            <div style="margin-top: 6px; display: flex; gap: 8px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="openModal('global-history-modal')" style="font-size: 11px; padding: 4px 10px;">
                <i class="fa-solid fa-file-import"></i> Open Batch CSV / JSON Importer
              </button>
            </div>
          </div>

          <!-- Solution for Reason 2: Schema Permissions -->
          <div style="font-size: 11.5px; line-height: 1.4; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
            <strong style="color: var(--text-primary);"><i class="fa-solid fa-key" style="color: var(--accent-blue);"></i> Fix Reason 2 (API Token Permissions):</strong><br/>
            Grant Schema Manager permissions to your Atlassian account inside Jira Assets:
            <div style="margin-top: 6px;">
              <a href="https://${savedSub}.atlassian.net/jira/servicedesk/assets/object-schemas" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 10px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Open Jira Assets Schema Permissions
              </a>
            </div>
          </div>

          <!-- Solution for Reason 3: True ID Extraction -->
          <div style="font-size: 11.5px; line-height: 1.4; color: var(--text-secondary);">
            <strong style="color: var(--text-primary);"><i class="fa-solid fa-database" style="color: var(--status-success);"></i> Fix Reason 3 (True ID Extraction):</strong><br/>
            Open these direct links in your browser to extract your true Cloud & Workspace IDs:
            <ul style="margin: 6px 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 6px; list-style-type: decimal;">
              <li>
                <a href="https://${savedSub}.atlassian.net/metadata/properties/id" target="_blank" style="color: var(--accent-blue); text-decoration: underline; font-weight: bold;">metadata/properties/id</a> (Cloud ID)
              </li>
              <li>
                <a href="https://${savedSub}.atlassian.net/rest/servicedeskapi/assets/workspace" target="_blank" style="color: var(--accent-blue); text-decoration: underline; font-weight: bold;">rest/servicedeskapi/assets/workspace</a> (Workspace ID)
              </li>
            </ul>
          </div>
        </div>
        
        <div class="error-details-block" style="margin-top: 10px;">Original System Error: ${escapeHTML(detailsMsg)}</div>
      `;
    } else {
      details.innerHTML = `
        <span>${t("conn_status_details_error")}</span>
        <div class="error-details-block">${escapeHTML(detailsMsg)}</div>
      `;
    }
  }
}

function toggleOfflineUI(isOffline) {
  const container = document.getElementById("atlassian-fields-container");
  const syncBtn = document.getElementById("sync-atlassian-btn");
  
  const cloudIdInput = document.getElementById("api-cloud-id");
  const workspaceIdInput = document.getElementById("api-workspace-id");
  const emailInput = document.getElementById("api-email");
  const tokenInput = document.getElementById("api-token");
  
  if (cloudIdInput && workspaceIdInput && emailInput && tokenInput) {
    if (isOffline) {
      cloudIdInput.removeAttribute("required");
      workspaceIdInput.removeAttribute("required");
      emailInput.removeAttribute("required");
      tokenInput.removeAttribute("required");
    } else {
      cloudIdInput.setAttribute("required", "");
      workspaceIdInput.setAttribute("required", "");
      emailInput.setAttribute("required", "");
      tokenInput.setAttribute("required", "");
    }
  }

  if (container) {
    if (isOffline) {
      container.classList.add("disabled-fade");
      const inputs = container.querySelectorAll("input, select, button");
      inputs.forEach(i => i.disabled = true);
    } else {
      container.classList.remove("disabled-fade");
      const inputs = container.querySelectorAll("input, select, button");
      inputs.forEach(i => {
        i.disabled = false;
      });
    }
  }

  if (syncBtn) {
    if (isOffline) {
      syncBtn.classList.add("disabled-fade");
      syncBtn.disabled = true;
    } else {
      syncBtn.classList.remove("disabled-fade");
      syncBtn.disabled = false;
    }
  }

  // Update Status Dashboard representation
  if (isOffline) {
    updateConnectionUI("offline");
  } else {
    // Restore normal representation
    if (!apiConfig.cloudId || !apiConfig.workspaceId || !apiConfig.email || !apiConfig.token) {
      updateConnectionUI("unconfigured");
    } else {
      const lastStatus = localStorage.getItem("assetGuard_last_sync_status") || "ready";
      const lastError = localStorage.getItem("assetGuard_last_sync_error") || "";
      updateConnectionUI(lastStatus, lastError);
    }
  }
}


async function resolveCloudId(subdomain) {
  const emailVal = (document.getElementById("api-email")?.value || "").trim() || apiConfig.email;
  const tokenVal = (document.getElementById("api-token")?.value || "").trim() || apiConfig.token;
  
  const headers = {};
  if (emailVal && tokenVal) {
    headers["Authorization"] = `Basic ${btoa(`${emailVal}:${tokenVal}`)}`;
  }
  headers["Accept"] = "application/json";

  const tenantInfoUrl = `https://${subdomain}.atlassian.net/_edge/tenant_info`;
  const serverInfoUrl = `https://${subdomain}.atlassian.net/rest/api/3/serverInfo`;
  const metadataUrl = `https://${subdomain}.atlassian.net/metadata/properties/id`;

  const urlsToTry = [tenantInfoUrl, serverInfoUrl, metadataUrl];

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          if (data.cloudId) {
            console.log("Resolved Cloud ID from tenant_info successfully!");
            return data.cloudId;
          }
          if (data.baseUrl && data.baseUrl.includes("/ex/jira/")) {
            const match = data.baseUrl.match(/\/ex\/jira\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (match) {
              console.log("Resolved Cloud ID from serverInfo successfully!");
              return match[1];
            }
          }
          if (data.id) {
            console.log("Resolved Cloud ID from metadata successfully!");
            return data.id;
          }
        }
      }
    } catch (e) {
      console.warn(`Direct fetch to ${url} failed (likely CORS), trying proxy fallback...`, e);
      try {
        let parsed = null;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const proxyRes = await fetch(proxyUrl);
        if (proxyRes.ok) {
          parsed = await proxyRes.json();
        }

        if (parsed) {
          if (parsed.cloudId) {
            console.log("Resolved Cloud ID via proxy from tenant_info successfully!");
            return parsed.cloudId;
          }
          if (parsed.baseUrl && parsed.baseUrl.includes("/ex/jira/")) {
            const match = parsed.baseUrl.match(/\/ex\/jira\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (match) {
              console.log("Resolved Cloud ID via proxy from serverInfo successfully!");
              return match[1];
            }
          }
          if (parsed.id) {
            console.log("Resolved Cloud ID via proxy from metadata successfully!");
            return parsed.id;
          }
        }
      } catch (proxyError) {
        console.error(`Proxy fetch to ${url} also failed:`, proxyError);
      }
    }
  }
  return null;
}

async function resolveWorkspaceId(cloudId, originalSubdomain) {
  const auth = btoa(`${apiConfig.email}:${apiConfig.token}`);
  const headers = {
    "Authorization": `Basic ${auth}`,
    "Accept": "application/json"
  };

  const urls = [];
  if (originalSubdomain) {
    urls.push(`https://${originalSubdomain}.atlassian.net/rest/servicedeskapi/assets/workspace`);
  }
  if (cloudId && cloudId.includes("-")) {
    urls.push(`https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi/assets/workspace`);
  }
  
  // Backups
  if (originalSubdomain) {
    urls.push(`https://${originalSubdomain}.atlassian.net/rest/servicedeskapi/insight/workspace`);
  }
  if (cloudId && cloudId.includes("-")) {
    urls.push(`https://api.atlassian.com/ex/jira/${cloudId}/rest/servicedeskapi/insight/workspace`);
  }

  let resolvedId = null;
  let lastError = null;

  for (const url of urls) {
    try {
      console.log("Attempting to resolve Workspace ID from:", url);
      let res;
      try {
        res = await fetch(url, { method: "GET", headers });
      } catch (fetchErr) {
        console.warn(`Direct fetch to ${url} failed, attempting proxy fallback...`, fetchErr);
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const proxyRes = await fetch(proxyUrl, { headers });
        if (proxyRes.ok) {
          res = proxyRes;
        }
        if (!res) throw fetchErr; // Fall through to catch if proxy resolution failed entirely
      }

      if (res && res.ok) {
        const data = await res.json();
        if (data && data.values && data.values.length > 0 && data.values[0].workspaceId) {
          resolvedId = data.values[0].workspaceId;
          break;
        }
      } else if (res) {
        const txt = await res.text();
        lastError = new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (resolvedId) {
    return resolvedId;
  } else {
    throw lastError || new Error("Workspace ID could not be found in response.");
  }
}

// Background Sync: Create object in Atlassian JSM Assets
async function pushNewAssetToAtlassian(asset) {
  if (isOfflineMode) {
    console.log("Atlassian Push (Create) bypassed: Active Offline Mode.");
    return;
  }
  if (!apiConfig.email || !apiConfig.token || !atlassianBaseUrl) {
    console.log("Atlassian Push (Create) bypassed: Missing configuration or base URL.");
    return;
  }

  const auth = btoa(`${apiConfig.email}:${apiConfig.token}`);
  const headers = {
    "Authorization": `Basic ${auth}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-ExperimentalApi": "opt-in"
  };

  const objectTypeId = localStorage.getItem("assetGuard_detected_object_type_id") || "2";
  const attrMap = JSON.parse(localStorage.getItem("assetGuard_attribute_map")) || {};

  const attributes = [];
  const addAttr = (name, val) => {
    const attrId = attrMap[name.toLowerCase()];
    if (attrId && val) {
      attributes.push({
        objectTypeAttributeId: attrId,
        objectAttributeValues: [{ value: String(val) }]
      });
    }
  };

  // Map fields dynamically based on synced schema mapping
  addAttr("Model", asset.name);
  addAttr("Category", asset.category);
  addAttr("Status", asset.status);
  addAttr("Owner", asset.owner);
  addAttr("Serial Number", asset.serialNumber || asset.serial);
  addAttr("Serial", asset.serialNumber || asset.serial);
  addAttr("Location", asset.location);
  
  if (asset.specs) {
    addAttr("CPU", asset.specs.cpu);
    addAttr("RAM", asset.specs.ram);
    addAttr("Storage", asset.specs.storage);
    addAttr("OS", asset.specs.os);
  }

  const payload = {
    objectTypeId,
    attributes
  };

  try {
    console.log("Pushing new asset to Atlassian:", payload);
    const res = await fetch(`${atlassianBaseUrl}/object`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.id) {
        console.log("Successfully created remote asset in Atlassian! ID:", data.id);
        asset.atlassianObjectId = data.id;
        saveState();
        showToast("Asset pushed to Atlassian Cloud!", "success");
      }
    } else {
      const txt = await res.text();
      console.warn("Atlassian POST failed:", txt);
    }
  } catch (err) {
    console.error("Atlassian POST network error:", err);
  }
}

// Background Sync: Update object in Atlassian JSM Assets
async function pushUpdateToAtlassian(asset) {
  if (isOfflineMode) {
    console.log("Atlassian Push (Update) bypassed: Active Offline Mode.");
    return;
  }
  if (!apiConfig.email || !apiConfig.token || !atlassianBaseUrl || !asset.atlassianObjectId) {
    console.log("Atlassian Push (Update) bypassed: Missing configuration, base URL, or remote ID.");
    return;
  }

  const auth = btoa(`${apiConfig.email}:${apiConfig.token}`);
  const headers = {
    "Authorization": `Basic ${auth}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-ExperimentalApi": "opt-in"
  };

  const attrMap = JSON.parse(localStorage.getItem("assetGuard_attribute_map")) || {};

  const attributes = [];
  const addAttr = (name, val) => {
    const attrId = attrMap[name.toLowerCase()];
    if (attrId) {
      attributes.push({
        objectTypeAttributeId: attrId,
        objectAttributeValues: [{ value: String(val || "") }]
      });
    }
  };

  // Map the updateable fields
  addAttr("Status", asset.status);
  addAttr("Owner", asset.owner);
  addAttr("Location", asset.location);

  const payload = {
    attributes
  };

  try {
    console.log(`Pushing updates to Atlassian for asset ${asset.atlassianObjectId}:`, payload);
    const res = await fetch(`${atlassianBaseUrl}/object/${asset.atlassianObjectId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      console.log("Successfully updated remote asset in Atlassian!");
      showToast("Updates pushed to Atlassian Cloud!", "success");
    } else {
      const txt = await res.text();
      console.warn("Atlassian PUT failed:", txt);
    }
  } catch (err) {
    console.error("Atlassian PUT network error:", err);
  }
}

// Atlassian API Sync Logic
async function syncWithAtlassian() {
  if (isOfflineMode) {
    showToast("Sync bypassed: Active Offline Mode.", "warning");
    return;
  }

  // Refresh apiConfig directly from DOM input fields so Sync Now works instantly
  const cloudEl = document.getElementById("api-cloud-id");
  const workspaceEl = document.getElementById("api-workspace-id");
  const emailEl = document.getElementById("api-email");
  const tokenEl = document.getElementById("api-token");
  const limitEl = document.getElementById("api-sync-limit");

  if (cloudEl && cloudEl.value.trim()) apiConfig.cloudId = cloudEl.value.trim();
  if (workspaceEl && workspaceEl.value.trim()) apiConfig.workspaceId = workspaceEl.value.trim();
  if (emailEl && emailEl.value.trim()) apiConfig.email = emailEl.value.trim();
  if (tokenEl && tokenEl.value.trim()) apiConfig.token = tokenEl.value.trim();
  if (limitEl && limitEl.value) apiConfig.syncLimit = parseInt(limitEl.value) || 100;
  
  saveState();

  if (!apiConfig.cloudId || !apiConfig.workspaceId || !apiConfig.email || !apiConfig.token) {
    showToast(t("notif_sync_error").replace("{error}", "Missing API Config (Cloud ID, Workspace ID, Email, or Token)"), "error");
    openModal("settings-modal");
    updateConnectionUI("error", "Missing configuration fields.");
    return;
  }

  // Prevent common user copy-paste errors where Cloud ID and Workspace ID are identical UUIDs
  if (apiConfig.cloudId.trim().toLowerCase() === apiConfig.workspaceId.trim().toLowerCase()) {
    const errorMsg = "Configuration Error: Your Cloud ID and Workspace ID are identical! They must be different UUIDs. Check Assets URL for Workspace ID.";
    updateConnectionUI("error", errorMsg);
    showToast(errorMsg, "error");
    openModal("settings-modal");
    return;
  }

  // Dynamic, schema-agnostic universal Atlassian Assets AQL query
  const customAql = localStorage.getItem("assetGuard_aql_query");
  const targetAqlQuery = (customAql && customAql.trim()) ? customAql.trim() : "id > 0";
  console.log("Compiled schema-agnostic universal AQL query:", targetAqlQuery);

  updateConnectionUI("syncing", t("sync_loading"));
  showToast(t("sync_loading"), "info");

  // Keep track of our actual runtime Cloud ID and Workspace ID
  let targetCloudId = apiConfig.cloudId;
  let targetWorkspaceId = apiConfig.workspaceId;

  const isSubdomain = !targetCloudId.includes("-");

  // Stage 1: Auto-resolve Cloud ID if it is a subdomain
  if (isSubdomain) {
    console.log("Cloud ID is a subdomain. Attempting to resolve to UUID...");
    updateConnectionUI("syncing", "Resolving Cloud ID...");
    const resolvedCloud = await resolveCloudId(targetCloudId);
    if (resolvedCloud) {
      // Save the human-readable subdomain before we overwrite apiConfig.cloudId with the UUID!
      localStorage.setItem("assetGuard_subdomain", targetCloudId);
      
      console.log("Resolved Cloud ID UUID:", resolvedCloud);
      targetCloudId = resolvedCloud;
      // Also update stored config so we don't have to resolve next time
      apiConfig.cloudId = resolvedCloud;
      const cloudInput = document.getElementById("api-cloud-id");
      if (cloudInput) cloudInput.value = resolvedCloud;
      saveState();
    }
  }

  // Stage 2: Auto-resolve Workspace UUID if targetWorkspaceId is a short Schema ID or non-UUID
  if (!isValidUUID(targetWorkspaceId)) {
    console.log(`Workspace ID '${targetWorkspaceId}' is not a valid 36-char UUID. Attempting to resolve true Workspace UUID...`);
    updateConnectionUI("syncing", "Resolving Workspace ID...");
    try {
      const resolvedWs = await resolveWorkspaceId(targetCloudId, sub);
      if (resolvedWs) {
        console.log("Successfully resolved true Workspace UUID:", resolvedWs);
        targetWorkspaceId = resolvedWs;
        apiConfig.workspaceId = resolvedWs;
        const wsInput = document.getElementById("api-workspace-id");
        if (wsInput) wsInput.value = resolvedWs;
        saveState();
      }
    } catch (wsErr) {
      console.warn("Workspace ID resolution failed, using provided ID:", wsErr.message);
    }
  }

  updateConnectionUI("syncing", "Fetching Assets from Atlassian...");

  // Define the common Atlassian Assets API path variants using final UUIDs
  const paths = [];
  
  // 1. Prioritize known working base URL if we have synced successfully before
  if (atlassianBaseUrl) {
    // If targetWorkspaceId is a UUID but the cached base URL contains a legacy schema integer ID,
    // or vice versa, discard the stale cached base URL to avoid 404 loops or slow timeouts!
    const isTargetUuid = isValidUUID(targetWorkspaceId);
    const cachedContainsUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(atlassianBaseUrl);
    
    if (isTargetUuid === cachedContainsUuid) {
      const verifiedPath = `${atlassianBaseUrl}/object/aql`;
      paths.push(verifiedPath);
    } else {
      console.warn("Discarding stale cached base URL due to format mismatch:", atlassianBaseUrl);
      sessionStorage.removeItem("assetGuard_base_url");
      atlassianBaseUrl = "";
    }
  }

  // Retrieve saved subdomain or extract from cloudId/localStorage
  let sub = localStorage.getItem("assetGuard_subdomain") || "";
  if (!sub && apiConfig.cloudId) {
    if (apiConfig.cloudId.includes(".atlassian.net")) {
      sub = apiConfig.cloudId.split(".atlassian.net")[0].replace("https://", "").replace("http://", "");
    } else if (!apiConfig.cloudId.includes("-")) {
      sub = apiConfig.cloudId.trim();
    }
  }

  // 2. Direct Subdomain API paths (Natively supports Basic Auth API Tokens & Legacy Insight endpoints!)
  if (sub) {
    const directPaths = [
      `https://${sub}.atlassian.net/gateway/api/jsm/assets/workspace/${targetWorkspaceId}/v1/object/aql`,
      `https://${sub}.atlassian.net/rest/servicedeskapi/assets/workspace/${targetWorkspaceId}/v1/object/aql`,
      `https://${sub}.atlassian.net/jsm/assets/workspace/${targetWorkspaceId}/v1/object/aql`,
      `https://${sub}.atlassian.net/rest/servicedesk/assets/1.0/object/aql`,
      `https://${sub}.atlassian.net/rest/insight/1.0/object/aql`,
      `https://${sub}.atlassian.net/rest/insight/1.0/object/aql?objectSchemaId=${targetWorkspaceId}`,
      `https://${sub}.atlassian.net/rest/servicedeskapi/insight/workspace/${targetWorkspaceId}/v1/object/aql`
    ];
    directPaths.forEach(p => {
      if (!paths.includes(p)) paths.push(p);
    });
  }

  // 3. Official OAuth Public API Gateway paths (using resolved UUIDs)
  if (targetCloudId && targetCloudId.includes("-")) {
    const p1 = `https://api.atlassian.com/ex/jira/${targetCloudId}/jsm/assets/workspace/${targetWorkspaceId}/v1/object/aql`;
    const p2 = `https://api.atlassian.com/ex/jira/${targetCloudId}/assets/workspace/${targetWorkspaceId}/v1/object/aql`;
    if (!paths.includes(p1)) paths.push(p1);
    if (!paths.includes(p2)) paths.push(p2);
  }

  // 4. Global Fallbacks
  const pFallback = `https://api.atlassian.com/jsm/assets/workspace/${targetWorkspaceId}/v1/object/aql`;
  if (!paths.includes(pFallback)) paths.push(pFallback);

  let success = false;
  let lastError = null;
  let remoteAssets = [];

  for (let i = 0; i < paths.length; i++) {
    let pageStart = 0;
    const pageLimit = 25; // Atlassian enforces a strict maximum page-size limit of 25 for AQL queries. Keeping this at 25 allows smooth, infinite page-looping!
    let allValuesForPath = [];
    let pathSuccess = false;
    let hasMore = true;

    while (hasMore) {
      const currentUrl = `${paths[i]}?start=${pageStart}&limit=${pageLimit}&resultsPerPage=${pageLimit}&cb=${Date.now()}`;
      console.log(`Syncing page starting at ${pageStart}...`, currentUrl);

      // Create a 5-second network timeout controller to prevent syncing hangs
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const auth = btoa(`${apiConfig.email}:${apiConfig.token}`);
        const response = await fetch(currentUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-ExperimentalApi": "opt-in"
          },
          body: JSON.stringify({
            qlQuery: targetAqlQuery,
            includeAttributes: true,
            start: pageStart,
            resultsPerPage: pageLimit
          })
        });

        clearTimeout(timeoutId);

        if (response && response.ok) {
          const data = await response.json();
          if (data && data.values && data.values.length > 0) {
            allValuesForPath = allValuesForPath.concat(data.values);
            updateConnectionUI("syncing", `Syncing: Loaded ${allValuesForPath.length} assets from Jira...`);
            pageStart += data.values.length;
            const maxSyncLimit = apiConfig.syncLimit || 100;
            if (allValuesForPath.length >= maxSyncLimit) {
              hasMore = false;
            } else if (data.totalFilterCount !== undefined && allValuesForPath.length >= data.totalFilterCount) {
              hasMore = false;
            } else if (data.values.length < pageLimit || data.isLastPage === true) {
              hasMore = false;
            }
            pathSuccess = true;
          } else {
            hasMore = false;
          }
        } else if (response) {
          const errText = await response.text();
          let errTextClean = errText || response.statusText;
          if (response.status === 404) {
            errTextClean = "Jira Assets path not found (404 Not Found). Note: Basic Auth API Tokens require your site subdomain (e.g. company) in the Cloud ID / Subdomain field!";
          }
          lastError = new Error(`HTTP ${response.status}: ${errTextClean}`);
          console.warn(`Page starting at ${pageStart} failed:`, lastError.message);
          hasMore = false;
          pathSuccess = false;
        }
      } catch (err) {
        // Fallback: Use CORS Proxy wrapper (corsproxy.io) which forwards Authorization headers directly to Atlassian!
        try {
          console.log(`Direct fetch blocked by browser CORS. Retrying via header-preserving CORS Proxy wrapper for ${currentUrl}...`);
          const auth = btoa(`${apiConfig.email}:${apiConfig.token}`);
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(currentUrl)}`;
          
          const proxyRes = await fetch(proxyUrl, {
            method: "POST",
            headers: {
              "Authorization": `Basic ${auth}`,
              "Content-Type": "application/json",
              "Accept": "application/json",
              "X-ExperimentalApi": "opt-in"
            },
            body: JSON.stringify({
              qlQuery: targetAqlQuery,
              includeAttributes: true,
              start: pageStart,
              resultsPerPage: pageLimit
            })
          });
          
          if (proxyRes && proxyRes.ok) {
            const data = await proxyRes.json();
            if (data && data.values && data.values.length > 0) {
              allValuesForPath = allValuesForPath.concat(data.values);
              updateConnectionUI("syncing", `Syncing via Proxy: Loaded ${allValuesForPath.length} assets from Jira...`);
              pageStart += data.values.length;
              const maxSyncLimit = apiConfig.syncLimit || 100;
              if (allValuesForPath.length >= maxSyncLimit) {
                hasMore = false;
              } else if (data.totalFilterCount !== undefined && allValuesForPath.length >= data.totalFilterCount) {
                hasMore = false;
              } else if (data.values.length < pageLimit || data.isLastPage === true) {
                hasMore = false;
              }
              pathSuccess = true;
            } else {
              hasMore = false;
            }
          } else if (proxyRes) {
            const txt = await proxyRes.text();
            lastError = new Error(`Proxy HTTP ${proxyRes.status}: ${txt || proxyRes.statusText}`);
            console.warn(`Proxy attempt on page starting at ${pageStart} failed:`, lastError.message);
            hasMore = false;
            pathSuccess = false;
          }
        } catch (proxyErr) {
          lastError = proxyErr;
          console.warn(`Proxy exception on page starting at ${pageStart}:`, proxyErr.message);
          hasMore = false;
          pathSuccess = false;
        }
      }
    }

    if (pathSuccess && allValuesForPath.length > 0) {
      remoteAssets = allValuesForPath.map(mapAtlassianObject);
      success = true;

      // Save working base URL and dynamic mapping
      const currentBase = paths[i].replace("/object/aql", "");
      sessionStorage.setItem("assetGuard_base_url", currentBase);
      atlassianBaseUrl = currentBase;

      // Build attribute ID mapping dynamically from the synced assets' attributes
      const attrMap = {};
      let detectedObjectTypeId = "";
      allValuesForPath.forEach(obj => {
        if (obj.objectType && obj.objectType.id) {
          detectedObjectTypeId = obj.objectType.id;
        }
        if (obj.attributes) {
          obj.attributes.forEach(attr => {
            if (attr.objectTypeAttribute && attr.objectTypeAttribute.name && attr.objectTypeAttribute.id) {
              attrMap[attr.objectTypeAttribute.name.toLowerCase()] = attr.objectTypeAttribute.id;
            }
          });
        }
      });
      if (detectedObjectTypeId) {
        localStorage.setItem("assetGuard_detected_object_type_id", detectedObjectTypeId);
      }
      localStorage.setItem("assetGuard_attribute_map", JSON.stringify(attrMap));

      console.log(`Sync succeeded on Path ${i + 1} with ${allValuesForPath.length} total assets retrieved!`);
      break; // Stop trying other paths
  }

  // Universal Fallback: If JSM Assets AQL endpoints return 404, query core Jira Search API (works on ALL Atlassian sites)
  if (!success && sub) {
    console.log("JSM Assets AQL paths returned 404. Attempting Universal Jira Search API fallback...");
    updateConnectionUI("syncing", "Syncing via Universal Jira Search API...");
    try {
      const jiraSearchUrl = `https://${sub}.atlassian.net/rest/api/3/search?jql=${encodeURIComponent("ORDER BY updated DESC")}&maxResults=50`;
      const auth = btoa(`${apiConfig.email}:${apiConfig.token}`);
      
      let res;
      try {
        res = await fetch(jiraSearchUrl, {
          headers: {
            "Authorization": `Basic ${auth}`,
            "Accept": "application/json"
          }
        });
      } catch (fErr) {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(jiraSearchUrl)}`;
        res = await fetch(proxyUrl, {
          headers: {
            "Authorization": `Basic ${auth}`,
            "Accept": "application/json"
          }
        });
      }

      if (res && res.ok) {
        const jiraData = await res.json();
        if (jiraData && jiraData.issues && jiraData.issues.length > 0) {
          remoteAssets = jiraData.issues.map(issue => ({
            atlassianObjectId: issue.id,
            id: issue.key,
            name: issue.fields.summary || issue.key,
            model: issue.fields.issuetype ? issue.fields.issuetype.name : "Jira Asset Item",
            category: issue.fields.project ? issue.fields.project.name : "IT Asset",
            status: issue.fields.status ? issue.fields.status.name : "Open",
            owner: issue.fields.assignee ? issue.fields.assignee.displayName : (issue.fields.reporter ? issue.fields.reporter.displayName : "Unassigned"),
            condition: "Good",
            serial: issue.key,
            location: "Corporate Office",
            lastUpdated: new Date().toLocaleDateString(),
            history: [{
              date: new Date().toLocaleDateString(),
              type: "Sync",
              user: "System",
              note: "Synchronized via Universal Jira API"
            }],
            specs: {
              cpu: "---",
              ram: "---",
              storage: "---",
              os: "---"
            }
          }));
          success = true;
          console.log(`Universal Jira Search API fallback succeeded! Retrieved ${remoteAssets.length} assets from Jira!`);
        }
      }
    } catch (fallbackErr) {
      console.warn("Universal Jira Search API fallback error:", fallbackErr.message);
    }
  }

  if (success) {
    // Merge strategy: Remote Overwrites Local (Atlassian Wins)
    remoteAssets.forEach(remote => {
      const index = assets.findIndex(a => a.id.toLowerCase() === remote.id.toLowerCase());
      if (index !== -1) {
        assets[index] = { ...assets[index], ...remote };
      } else {
        assets.push(remote);
      }
    });

    localStorage.setItem("assetGuard_last_sync_count", remoteAssets.length);
    saveState();
    updateMetrics();
    renderAssetList();
    updateConnectionUI("connected");
    showToast(t("notif_sync_success").replace("{count}", remoteAssets.length), "success");
  } else {
    console.error("All sync paths failed. Last error:", lastError);
    const errMsg = lastError ? lastError.message : "404 Not Found";
    
    // Ensure dashboard displays existing local assets smoothly despite network failures
    renderAssetList();
    updateMetrics();
    
    updateConnectionUI("error", errMsg);
    showToast(`Cloud Sync Unverified: ${errMsg.substring(0, 60)}. You can toggle Offline Sandbox Mode in Settings for 100% instant local operation.`, "warning");
  }
}

function mapAtlassianObject(obj) {
  const getAttr = (candidates) => {
    if (!obj.attributes) return "";
    const candidateList = Array.isArray(candidates) ? candidates.map(c => c.toLowerCase()) : [candidates.toLowerCase()];
    
    // Find matching attribute by checking all candidate attribute names
    const attr = obj.attributes.find(a => 
      a.objectTypeAttribute && candidateList.includes(a.objectTypeAttribute.name.toLowerCase())
    );
    if (attr && attr.objectAttributeValues && attr.objectAttributeValues.length > 0) {
      return attr.objectAttributeValues[0].displayValue || attr.objectAttributeValues[0].value || "";
    }
    return "";
  };

  const detectedCategory = (obj.objectType && obj.objectType.name) ? obj.objectType.name : (getAttr(["Category", "Asset Category", "Object Type", "Device Type", "Type", "Kind"]) || "IT Asset");
  const detectedModel = getAttr(["Model", "Model Name", "Hardware Model", "Device Model", "Item Name", "Brand", "Device", "Title"]) || obj.name || obj.label || "Standard Model";
  const detectedStatus = getAttr(["Status", "State", "Lifecycle", "Asset Status", "Availability"]) || "Open";
  const detectedOwner = getAttr(["Owner", "Assignee", "Assigned To", "User", "Custodian", "Employee", "Reporter"]) || "";
  const detectedSerial = getAttr(["Serial Number", "Serial", "Serial No", "SerialNo", "S/N", "Asset Tag", "Tag", "Barcode", "Hardware ID", "Key"]) || obj.id || "N/A";
  const detectedLocation = getAttr(["Location", "Site", "Office", "Building", "Facility", "Room", "Department"]) || "Corporate Office";
  const detectedCondition = getAttr(["Condition", "Physical Condition", "Health", "Grade"]) || "Good";

  return {
    atlassianObjectId: obj.id, // Store original Jira Assets ID
    id: obj.label || obj.name || obj.id,
    name: obj.name || obj.label || obj.id,
    model: detectedModel,
    category: detectedCategory,
    status: detectedStatus,
    owner: detectedOwner,
    condition: detectedCondition,
    serial: detectedSerial,
    location: detectedLocation,
    lastUpdated: new Date().toLocaleDateString(),
    history: [{
      date: new Date().toLocaleDateString(),
      type: "Sync",
      user: "System",
      note: "Synchronized from Atlassian Assets"
    }],
    specs: {
      cpu: getAttr(["CPU", "Processor", "Processor Type", "Chip"]) || "---",
      ram: getAttr(["RAM", "Memory", "RAM Size", "System Memory"]) || "---",
      storage: getAttr(["Storage", "Hard Drive", "SSD", "HDD", "Disk"]) || "---",
      os: getAttr(["OS", "Operating System", "OS Version", "System"]) || "---"
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
function renderAssetList(resetPage = false) {
  if (resetPage) currentPage = 1;

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

  const totalPages = Math.ceil(filtered.length / assetsPerPage);
  if (currentPage > totalPages) currentPage = Math.max(1, totalPages);

  const startNum = filtered.length === 0 ? 0 : (currentPage - 1) * assetsPerPage + 1;
  const endNum = Math.min(currentPage * assetsPerPage, filtered.length);

  const counterEl = document.getElementById("results-counter");
  if (counterEl) {
    counterEl.textContent = `Showing ${startNum} - ${endNum} of ${filtered.length} assets (Total: ${assets.length})`;
  }

  // Manage client-side pagination buttons state & visibility
  const paginationControls = document.getElementById("pagination-controls");
  const pageIndicator = document.getElementById("page-indicator");
  const prevBtn = document.getElementById("prev-page-btn");
  const nextBtn = document.getElementById("next-page-btn");
  
  if (paginationControls && pageIndicator && prevBtn && nextBtn) {
    if (filtered.length > assetsPerPage) {
      paginationControls.style.display = "flex";
      pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
      prevBtn.disabled = (currentPage === 1);
      nextBtn.disabled = (currentPage === totalPages);
    } else {
      paginationControls.style.display = "none";
    }
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

  // Slice results to render only the 50 assets for the current page
  const pageAssets = filtered.slice((currentPage - 1) * assetsPerPage, currentPage * assetsPerPage);

  pageAssets.forEach((asset, index) => {
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

// Helper to resolve Atlassian Direct Object URL
function getAtlassianObjectUrl(objectId) {
  let sub = localStorage.getItem("assetGuard_subdomain") || "";
  if (!sub && apiConfig.cloudId && !apiConfig.cloudId.includes("-")) {
    sub = apiConfig.cloudId;
  }
  if (!sub) {
    sub = "smm-sandbox"; // Standard project fallback
  }
  return `https://${sub}.atlassian.net/jira/assets/object/${objectId}`;
}

// Open Detail/Action Modal
function openDetailsModal(assetId, defaultTab = "overview") {
  const asset = assets.find(a => (a.id || "").toLowerCase() === assetId.toLowerCase());
  if (!asset) {
    showToast(t("notif_not_found"), "error");
    return;
  }

  // Set Title
  document.getElementById("details-modal-title").textContent = asset.id;

  // Atlassian Link Setup
  const jiraLinkContainer = document.getElementById("view-jira-link-container");
  const jiraLink = document.getElementById("view-jira-link");
  if (jiraLinkContainer && jiraLink) {
    if (asset.atlassianObjectId) {
      jiraLink.href = getAtlassianObjectUrl(asset.atlassianObjectId);
      jiraLinkContainer.style.display = "block";
    } else {
      jiraLinkContainer.style.display = "none";
    }
  }

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

  // Reset tab focus to parameterized defaultTab
  switchDetailTab(defaultTab);

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
  // Defensive helper to attach listeners safely
  function on(id, event, callback) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, callback);
  }

  // Defensive helper for selectors
  function onSelector(selector, event, callback) {
    const el = document.querySelector(selector);
    if (el) el.addEventListener(event, callback);
  }

  // Import Data (.csv or .json)
  on("import-data-btn", "click", () => {
    const fileInput = document.getElementById("import-file-input");
    if (fileInput) fileInput.click();
  });

  on("import-file-input", "change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result;
      let importedCount = 0;

      try {
        if (file.name.endsWith(".json")) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            parsed.forEach(item => {
              if (item.id && !assets.some(a => a.id === item.id)) {
                assets.unshift(item);
                importedCount++;
              }
            });
          }
        } else if (file.name.endsWith(".csv")) {
          const lines = content.split(/\r?\n/).filter(line => line.trim());
          if (lines.length > 1) {
            const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ""));
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split(",").map(c => c.trim().replace(/^["']|["']$/g, ""));
              if (cols.length >= 2) {
                const assetId = cols[0] || `ASSET-${Date.now()}-${i}`;
                if (!assets.some(a => a.id === assetId)) {
                  assets.unshift({
                    id: assetId,
                    name: cols[1] || "Imported Asset",
                    category: cols[2] || "Hardware",
                    status: cols[3] || "In Use",
                    owner: cols[4] || "Unassigned",
                    location: cols[5] || "Main Office",
                    serialNumber: cols[6] || `SN-${assetId}`,
                    acquisitionDate: new Date().toISOString().split("T")[0],
                    condition: "Good",
                    specs: { cpu: "N/A", ram: "N/A", storage: "N/A", os: "N/A" },
                    history: [{ date: new Date().toISOString().split("T")[0], action: "Imported", details: `Imported from ${file.name}` }]
                  });
                  importedCount++;
                }
              }
            }
          }
        }

        saveState();
        updateMetrics();
        renderAssetList();
        showToast(`✨ Successfully imported ${importedCount} assets!`, "success");
        closeModal("global-history-modal");
      } catch (err) {
        console.error("Import error:", err);
        showToast("Error importing file. Please verify CSV or JSON format.", "error");
      }
      e.target.value = ""; // Reset input
    };
    reader.readAsText(file);
  });

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
      renderAssetList(true);
    }
  });

  // More Categories dropdown selection
  on("more-categories-select", "change", (e) => {
    const selectedCategory = e.target.value;
    if (!selectedCategory) return; // Ignore placeholder option selection
    
    // Deselect all quick chips
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    
    activeCategory = selectedCategory;
    renderAssetList(true);
  });

  // Status filters click
  on("status-filters", "click", (e) => {
    if (e.target.classList.contains("filter-chip")) {
      document.querySelectorAll(".filter-chip").forEach(btn => btn.classList.remove("active"));
      e.target.classList.add("active");
      activeStatus = e.target.getAttribute("data-status");
      renderAssetList(true);
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
    renderAssetList(true);
  });

  // Client-Side Pagination controls
  on("prev-page-btn", "click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderAssetList();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  on("next-page-btn", "click", () => {
    // Dynamically check total filtered assets to cap the next page action
    const filteredCount = assets.filter(asset => {
      let categoryMatch = (activeCategory === "All") || (activeCategory === asset.category);
      let statusMatch = (activeStatus === "All") || (activeStatus === asset.status);
      const terms = searchQuery.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
      const searchMatch = terms.every(term => {
        return (asset.id || "").toLowerCase().includes(term) ||
               (asset.name || "").toLowerCase().includes(term) ||
               (asset.owner || "").toLowerCase().includes(term) ||
               (asset.category || "").toLowerCase().includes(term) ||
               (asset.condition || "").toLowerCase().includes(term);
      });
      return categoryMatch && statusMatch && searchMatch;
    }).length;

    const totalPages = Math.ceil(filteredCount / assetsPerPage);
    if (currentPage < totalPages) {
      currentPage++;
      renderAssetList();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
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
    const assistant = document.getElementById("magic-setup-assistant");
    if (assistant) assistant.style.display = "none";
    const aqlInput = document.getElementById("api-aql-query");
    if (aqlInput) aqlInput.value = localStorage.getItem("assetGuard_aql_query") || "";
    openModal("settings-modal");
  });

  // Magic URL Sniffer (Unified Processor)
  function processMagicUrl(url) {
    if (!url) return;
    
    // Check if pasted content is a JSON object
    const trimmed = url.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed);
        let loaded = false;
        
        // Check if it's the Cloud ID JSON: {"id":"UUID"}
        if (obj.id && isValidUUID(obj.id)) {
          const cloudInput = document.getElementById("api-cloud-id");
          if (cloudInput) cloudInput.value = obj.id;
          apiConfig.cloudId = obj.id;
          saveState();
          showToast("✨ Cloud ID UUID loaded from JSON!", "success");
          loaded = true;
        }
        
        // Check if it's the Workspace ID JSON: {"values":[{"workspaceId":"UUID"}]}
        if (obj.values && Array.isArray(obj.values) && obj.values.length > 0 && obj.values[0].workspaceId && isValidUUID(obj.values[0].workspaceId)) {
          const wId = obj.values[0].workspaceId;
          const workspaceInput = document.getElementById("api-workspace-id");
          if (workspaceInput) workspaceInput.value = wId;
          apiConfig.workspaceId = wId;
          saveState();
          showToast("✨ Workspace ID UUID loaded from JSON!", "success");
          loaded = true;
        } else if (obj.workspaceId && isValidUUID(obj.workspaceId)) {
          const workspaceInput = document.getElementById("api-workspace-id");
          if (workspaceInput) workspaceInput.value = obj.workspaceId;
          apiConfig.workspaceId = obj.workspaceId;
          saveState();
          showToast("✨ Workspace ID UUID loaded from JSON!", "success");
          loaded = true;
        }
        
        if (loaded) {
          const assistant = document.getElementById("magic-setup-assistant");
          if (assistant) assistant.style.display = "none";
          return;
        }
      } catch (err) {
        console.warn("Attempted to parse pasted JSON but failed:", err);
      }
    }

    if (!url.includes("atlassian.net") && !url.includes("api.atlassian.com")) return; 
    
    // Helper to clean IDs
    const clean = (id) => id ? id.replace(/[^a-z0-9-]/gi, "").trim() : "";

    // Method B Bypass: If the pasted URL already contains raw UUID strings (e.g. copied from Developer Tools), extract them directly
    // Clean and normalize URL
    url = url.trim().replace(/["']/g, "");
    console.log("Processing Magic URL link:", url);

    // If the pasted link is a raw JSON endpoint (like rest/servicedeskapi/assets/workspace), try to auto-fetch it if user provided token!
    if (url.includes("/rest/servicedeskapi/assets/workspace") || url.includes("/metadata/properties/id")) {
      const email = document.getElementById("api-email") ? document.getElementById("api-email").value.trim() : "";
      const token = document.getElementById("api-token") ? document.getElementById("api-token").value.trim() : "";
      if (email && token) {
        const auth = btoa(`${email}:${token}`);
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        fetch(proxyUrl, { headers: { "Authorization": `Basic ${auth}`, "Accept": "application/json" } })
          .then(res => res.json())
          .then(data => {
            if (data && data.values && data.values[0] && data.values[0].workspaceId) {
              const wsInput = document.getElementById("api-workspace-id");
              if (wsInput) wsInput.value = data.values[0].workspaceId;
              apiConfig.workspaceId = data.values[0].workspaceId;
              saveState();
              showToast("Workspace ID extracted from endpoint link successfully!", "success");
            } else if (data && data.id) {
              const cloudInput = document.getElementById("api-cloud-id");
              if (cloudInput) cloudInput.value = data.id;
              apiConfig.cloudId = data.id;
              saveState();
              showToast("Cloud ID extracted from endpoint link successfully!", "success");
            }
          })
          .catch(err => console.warn("Endpoint link auto-fetch notice:", err.message));
      }
    }

    // 1. Try to find Cloud ID and Workspace ID if the link contains direct UUIDs
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const allUUIDs = url.match(uuidPattern);
    
    if (allUUIDs && allUUIDs.length > 0) {
      let directCloudId = "";
      let directWorkspaceId = "";

      // 1. Try to find Cloud ID (following /ex/jira/)
      const cloudIdMatch = url.match(/\/ex\/jira\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (cloudIdMatch) directCloudId = cloudIdMatch[1];

      // 2. Try to find Workspace ID (following /workspace/ or /servicedesk/assets/ or /assets/)
      const workspaceIdMatch = url.match(/\/(?:workspace|servicedesk\/assets|assets)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (workspaceIdMatch) directWorkspaceId = workspaceIdMatch[1];

      if (!directCloudId && !directWorkspaceId && allUUIDs.length >= 2) {
        directCloudId = allUUIDs[0];
        directWorkspaceId = allUUIDs[1];
      } else if (!directCloudId && !directWorkspaceId && allUUIDs.length === 1) {
        if (url.includes("/ex/jira/")) directCloudId = allUUIDs[0];
        else directWorkspaceId = allUUIDs[0];
      }

      let updatedAny = false;
      if (directCloudId) {
        const cloudInput = document.getElementById("api-cloud-id");
        if (cloudInput) cloudInput.value = directCloudId;
        apiConfig.cloudId = directCloudId;
        updatedAny = true;
      }
      if (directWorkspaceId) {
        const workspaceInput = document.getElementById("api-workspace-id");
        if (workspaceInput) workspaceInput.value = directWorkspaceId;
        apiConfig.workspaceId = directWorkspaceId;
        updatedAny = true;
      }

      if (updatedAny) {
        saveState();
        showToast("Extracted secure UUIDs directly from link!", "success");
      }
    }

    // Extract Subdomain from link
    const domainMatch = url.match(/https?:\/\/([a-z0-9-]+)\.(atlassian\.net|jira\.com)/i);
    if (domainMatch) {
      const sub = domainMatch[1].toLowerCase();
      if (!["jira", "admin", "id", "assets"].includes(sub)) {
        localStorage.setItem("assetGuard_subdomain", sub);
        const cloudInput = document.getElementById("api-cloud-id");
        if (cloudInput && !cloudInput.value.includes("-")) {
          cloudInput.value = clean(sub);
          apiConfig.cloudId = sub;
        }
      }
    }
         // Render the customized Method B Assistant with direct URLs for their subdomain!
         const assistant = document.getElementById("magic-setup-assistant");
         if (assistant) {
           assistant.style.display = "block";
           assistant.innerHTML = `
             <div style="font-weight: bold; color: var(--accent-blue); margin-bottom: 6px; display: flex; align-items: center; gap: 6px; font-size: 12px;">
               <i class="fa-solid fa-wand-magic-sparkles"></i> Magic Setup Assistant
             </div>
             <p style="margin: 0 0 10px 0; font-size: 11px; color: var(--text-muted); line-height: 1.4;">
               The background resolver is automatically communicating with Atlassian using your Email & API Token to fetch and configure your secure UUIDs...
             </p>
             <div id="magic-status-step" style="font-size: 11.5px; color: var(--text-primary); font-weight: 600; display: flex; align-items: center; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 8px;">
               <i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-blue);"></i> Resolving secure Cloud UUID...
             </div>
           `;
         }
         
         // Background resolver to get the real long Cloud ID using our proxy fallback!
         showToast("Resolving Atlassian Cloud ID...", "info");
         resolveCloudId(sub)
           .then(resolvedCloud => {
             if (resolvedCloud) {
               const cloudInput = document.getElementById("api-cloud-id");
               if (cloudInput) cloudInput.value = resolvedCloud;
               apiConfig.cloudId = resolvedCloud;
               saveState();
               showToast("Cloud ID resolved successfully!", "success");
               
               const statusStep = document.getElementById("magic-status-step");
               if (statusStep) {
                 statusStep.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--status-success);"></i> Cloud ID UUID Resolved!`;
               }

               // Attempt to resolve Workspace ID automatically too if credentials are input!
               const emailInput = document.getElementById("api-email") ? document.getElementById("api-email").value.trim() : "";
               const tokenInput = document.getElementById("api-token") ? document.getElementById("api-token").value.trim() : "";
               if (emailInput && tokenInput && workspaceId && !isValidUUID(workspaceId)) {
                 showToast("Resolving Workspace ID...", "info");
                 apiConfig.email = emailInput;
                 apiConfig.token = tokenInput;
                 
                 if (statusStep) {
                   statusStep.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-blue);"></i> Resolving secure Workspace UUID...`;
                   resolveWorkspaceId(resolvedCloud, sub)
                    .then(resolvedWorkspace => {
                      if (statusStep) {
                        statusStep.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--status-success);"></i> Configuration Resolved & Saved!`;
                      }
                    });
                 }
               }
             } else {
               console.warn("Could not resolve Cloud ID to a UUID. Subdomain set as fallback.");
               const emailInput = document.getElementById("api-email") ? document.getElementById("api-email").value.trim() : "";
               const tokenInput = document.getElementById("api-token") ? document.getElementById("api-token").value.trim() : "";
               
               let warningMsg = "CORS block detected. Please use the direct links in the assistant box below!";
               let statusHtml = `
                 <div style="margin-top: 10px; border-top: 1px dashed var(--border-color); padding-top: 10px; font-size: 11.5px; line-height: 1.45; text-align: left;">
                   <span style="color: var(--status-warning); font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> Browser CORS Block Detected</span>
                   <p style="margin: 4px 0 8px 0; color: var(--text-muted);">Your browser's security blocks background UUID fetching. To configure in 5 seconds:</p>
                   <ol style="margin: 0; padding-left: 16px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 6px;">
                     <li>
                       Open <a href="https://${sub}.atlassian.net/metadata/properties/id" target="_blank" style="color: var(--accent-blue); text-decoration: underline; font-weight: bold;">Cloud ID JSON</a> in a new tab.<br/>
                       Copy the text on that page, paste it here, and watch it configure your Cloud ID instantly!
                     </li>
                     <li>
                       Open <a href="https://${sub}.atlassian.net/rest/servicedeskapi/assets/workspace" target="_blank" style="color: var(--accent-blue); text-decoration: underline; font-weight: bold;">Workspace ID JSON</a> in a new tab.<br/>
                       Copy the text on that page, paste it here, and watch it configure your Workspace ID instantly!
                     </li>
                   </ol>
                 </div>
               `;
               
               if (!emailInput || !tokenInput) {
                 warningMsg = "⚠️ Please enter your Atlassian Email & API Token FIRST so we can securely login to your private sandbox!";
                 statusHtml = `<i class="fa-solid fa-key" style="color: var(--status-warning);"></i> Please enter your Email & API Token first!`;
               }
               
               showToast(warningMsg, "warning");
               const statusStep = document.getElementById("magic-status-step");
               if (statusStep) {
                 statusStep.innerHTML = statusHtml;
               }
             }
           })
           .catch(err => {
             console.log("Background ID resolver exception:", err);
             showToast("Workspace ID loaded. Subdomain saved as fallback.", "info");
           });
       }
    }
    
    saveState();
  }

  // Bind the Magic Sniffer to both INPUT and PASTE events on the magic url box
  on("api-magic-url", "input", (e) => {
    processMagicUrl(e.target.value.trim());
  });
  on("api-magic-url", "paste", (e) => {
    // Let clipboard capture populate the input box first, then process
    setTimeout(() => {
      const magicInput = document.getElementById("api-magic-url");
      if (magicInput) {
        processMagicUrl(magicInput.value.trim());
      }
    }, 50);
  });

  // Secondary catch-all fallback: Global Paste Listener for Settings Modal
  on("settings-modal", "paste", (e) => {
    const url = (e.clipboardData || window.clipboardData).getData('text').trim();
    processMagicUrl(url);
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

  // Mode Toggles: Short Subdomain vs Long Cloud UUID
  on("cloud-mode-short-btn", "click", () => {
    document.getElementById("cloud-mode-short-btn").classList.add("active");
    document.getElementById("cloud-mode-short-btn").style.background = "var(--accent-blue)";
    document.getElementById("cloud-mode-short-btn").style.color = "white";
    document.getElementById("cloud-mode-uuid-btn").classList.remove("active");
    document.getElementById("cloud-mode-uuid-btn").style.background = "transparent";
    document.getElementById("cloud-mode-uuid-btn").style.color = "var(--text-secondary)";
    
    const input = document.getElementById("api-cloud-id");
    if (input) {
      input.placeholder = "e.g. your-subdomain (e.g. acme-corp)";
      const savedSub = localStorage.getItem("assetGuard_subdomain") || "";
      if (savedSub) input.value = savedSub;
    }
  });

  on("cloud-mode-uuid-btn", "click", () => {
    document.getElementById("cloud-mode-uuid-btn").classList.add("active");
    document.getElementById("cloud-mode-uuid-btn").style.background = "var(--accent-blue)";
    document.getElementById("cloud-mode-uuid-btn").style.color = "white";
    document.getElementById("cloud-mode-short-btn").classList.remove("active");
    document.getElementById("cloud-mode-short-btn").style.background = "transparent";
    document.getElementById("cloud-mode-short-btn").style.color = "var(--text-secondary)";
    
    const input = document.getElementById("api-cloud-id");
    if (input) {
      input.placeholder = "e.g. 12345678-abcd-1234-5678-1234567890ab";
      const savedUuid = localStorage.getItem("assetGuard_cloud_uuid") || "";
      if (savedUuid) input.value = savedUuid;
    }
  });

  // Mode Toggles: Short Schema ID vs Long Workspace UUID
  on("workspace-mode-short-btn", "click", () => {
    document.getElementById("workspace-mode-short-btn").classList.add("active");
    document.getElementById("workspace-mode-short-btn").style.background = "var(--accent-blue)";
    document.getElementById("workspace-mode-short-btn").style.color = "white";
    document.getElementById("workspace-mode-uuid-btn").classList.remove("active");
    document.getElementById("workspace-mode-uuid-btn").style.background = "transparent";
    document.getElementById("workspace-mode-uuid-btn").style.color = "var(--text-secondary)";
    
    const input = document.getElementById("api-workspace-id");
    if (input) {
      input.placeholder = "e.g. 3 or 14 (Schema ID)";
      const savedSchema = localStorage.getItem("assetGuard_schema_id") || "";
      if (savedSchema) input.value = savedSchema;
    }
  });

  on("workspace-mode-uuid-btn", "click", () => {
    document.getElementById("workspace-mode-uuid-btn").classList.add("active");
    document.getElementById("workspace-mode-uuid-btn").style.background = "var(--accent-blue)";
    document.getElementById("workspace-mode-uuid-btn").style.color = "white";
    document.getElementById("workspace-mode-short-btn").classList.remove("active");
    document.getElementById("workspace-mode-short-btn").style.background = "transparent";
    document.getElementById("workspace-mode-short-btn").style.color = "var(--text-secondary)";
    
    const input = document.getElementById("api-workspace-id");
    if (input) {
      input.placeholder = "e.g. 98765432-efgh-1234-5678-1234567890ab";
      const savedUuid = localStorage.getItem("assetGuard_workspace_uuid") || "";
      if (savedUuid) input.value = savedUuid;
    }
  });

  on("settings-close-btn", "click", () => {
    closeModal("settings-modal");
    document.getElementById("settings-help-section").style.display = "none"; // Reset for next time
    const assistant = document.getElementById("magic-setup-assistant");
    if (assistant) assistant.style.display = "none";
  });

  on("settings-form", "submit", (e) => {
    e.preventDefault();
    
    const cloudIdInputVal = document.getElementById("api-cloud-id").value.trim();
    const workspaceIdInputVal = document.getElementById("api-workspace-id").value.trim();

    if (cloudIdInputVal) {
      if (!cloudIdInputVal.includes("-")) {
        localStorage.setItem("assetGuard_subdomain", cloudIdInputVal);
      } else {
        localStorage.setItem("assetGuard_cloud_uuid", cloudIdInputVal);
      }
    }

    if (workspaceIdInputVal) {
      if (!workspaceIdInputVal.includes("-") && workspaceIdInputVal.length < 10) {
        localStorage.setItem("assetGuard_schema_id", workspaceIdInputVal);
      } else {
        localStorage.setItem("assetGuard_workspace_uuid", workspaceIdInputVal);
      }
    }

    const aqlInput = document.getElementById("api-aql-query");
    if (aqlInput && aqlInput.value.trim()) {
      localStorage.setItem("assetGuard_aql_query", aqlInput.value.trim());
    } else {
      localStorage.removeItem("assetGuard_aql_query");
    }

    apiConfig = {
      cloudId: cloudIdInputVal,
      workspaceId: workspaceIdInputVal,
      email: document.getElementById("api-email").value.trim(),
      token: document.getElementById("api-token").value.trim(),
      syncLimit: parseInt(document.getElementById("api-sync-limit").value) || 100
    };
    saveState();
    
    // Reset connection status upon saving new settings
    if (isOfflineMode) {
      updateConnectionUI("offline");
    } else if (!apiConfig.cloudId || !apiConfig.workspaceId || !apiConfig.email || !apiConfig.token) {
      localStorage.setItem("assetGuard_last_sync_status", "unconfigured");
      updateConnectionUI("unconfigured");
    } else {
      localStorage.setItem("assetGuard_last_sync_status", "ready");
      localStorage.setItem("assetGuard_last_sync_error", "");
      updateConnectionUI("ready");
    }
    
    closeModal("settings-modal");
    showToast(t("notif_config_saved"), "success");
  });

  on("clear-config-btn", "click", () => {
    if (confirm(t("confirm_clear_all"))) { 
      apiConfig = { cloudId: "", workspaceId: "", email: "", token: "", syncLimit: 100 };
      saveState();
      localStorage.removeItem("assetGuard_aql_query");
      localStorage.setItem("assetGuard_last_sync_status", "unconfigured");
      localStorage.setItem("assetGuard_last_sync_error", "");
      // Force UI update
      document.getElementById("api-cloud-id").value = "";
      document.getElementById("api-workspace-id").value = "";
      document.getElementById("api-email").value = "";
      document.getElementById("api-token").value = "";
      document.getElementById("api-sync-limit").value = "100";
      const aqlField = document.getElementById("api-aql-query");
      if (aqlField) aqlField.value = "";
      
      const assistant = document.getElementById("magic-setup-assistant");
      if (assistant) assistant.style.display = "none";

      updateConnectionUI("unconfigured");
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
    
    // Push updates to Atlassian Jira in the background
    pushUpdateToAtlassian(asset);
    
    closeModal("details-modal");
    showToast(t("notif_saved"), "success");
  });



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
    
    // Push new asset to Atlassian Jira in the background
    pushNewAssetToAtlassian(newAsset);
    
    // Reset Form & Close Modal
    document.getElementById("add-asset-form").reset();
    closeModal("add-asset-modal");
    showToast(t("notif_saved"), "success");
  });

  // Manual Scan Entry Logic
  on("manual-scan-btn", "click", () => {
    const manualInput = document.getElementById("manual-scan-input").value.trim();
    if (!manualInput) return;
    
    // Parse the input (supports raw ID, query params, or JSON strings)
    const parsed = parseScannedContent(manualInput);
    if (!parsed) return;
    
    // Normalize parsed ID for searching
    let normalizedId = (parsed.id || "").toLowerCase();
    if (normalizedId.startsWith("m") && normalizedId.length > 2) {
      normalizedId = "smm" + normalizedId.substring(1);
    }
    
    const existing = assets.find(a => {
      const assetIdLower = (a.id || "").toLowerCase();
      const assetSerialLower = (a.serialNumber || "").toLowerCase();
      return assetIdLower === normalizedId || 
             (parsed.serial && assetSerialLower === parsed.serial.toLowerCase()) ||
             (parsed.id && assetIdLower === parsed.id.toLowerCase());
    });
    
    // Close scanner first
    stopCameraScanner();
    closeModal("scanner-modal");
    document.getElementById("manual-scan-input").value = "";

    if (existing) {
      // If the laptop exists, open the details modal with the 'edit' (Actions) tab selected!
      showToast(t("notif_scan_success", { id: existing.id }), "success");
      openDetailsModal(existing.id, "edit");
    } else {
      // Open the Add screen for a new asset and automatically fill out all parsed fields
      showToast(t("notif_new_asset_scanned"), "info");
      openModal("add-asset-modal");
      prefillAddAssetForm(parsed);
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

      // Parse the decoded QR content (supports JSON, query params, or raw ID)
      const parsed = parseScannedContent(decodedText);
      if (!parsed) return;

      // Normalize scanned text ID (e.g. M2379 -> smm2379)
      let normalizedId = (parsed.id || "").toLowerCase();
      if (normalizedId.startsWith("m") && normalizedId.length > 2) {
        normalizedId = "smm" + normalizedId.substring(1);
      }

      const existing = assets.find(a => {
        const assetIdLower = (a.id || "").toLowerCase();
        const assetSerialLower = (a.serialNumber || "").toLowerCase();
        return assetIdLower === normalizedId || 
               (parsed.serial && assetSerialLower === parsed.serial.toLowerCase()) ||
               (parsed.id && assetIdLower === parsed.id.toLowerCase());
      });
      
      if (existing) {
        // Existing asset: open directly to the 'edit' actions tab
        showToast(t("notif_scan_success", { id: existing.id }), "success");
        openDetailsModal(existing.id, "edit");
      } else {
        // New asset found! Open the Add Asset Modal and pre-fill all available details
        showToast(t("notif_new_asset_scanned"), "info");
        openModal("add-asset-modal");
        prefillAddAssetForm(parsed);
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
      const cloudIdInput = document.getElementById("api-cloud-id");
      cloudIdInput.value = apiConfig.cloudId || "";
      document.getElementById("api-workspace-id").value = apiConfig.workspaceId || "";
      document.getElementById("api-email").value = apiConfig.email || "";
      document.getElementById("api-token").value = apiConfig.token || "";
      document.getElementById("api-sync-limit").value = apiConfig.syncLimit || "100";

      // Populate Offline Mode toggle
      const offlineToggle = document.getElementById("offline-mode-toggle");
      if (offlineToggle) {
        offlineToggle.checked = isOfflineMode;
        offlineToggle.onchange = (e) => {
          isOfflineMode = e.target.checked;
          saveState();
          toggleOfflineUI(isOfflineMode);
        };
      }



      // Function to dynamically update the help links
      const updateHelpLinks = () => {
        let subdomain = cloudIdInput.value.trim() || "smm-sandbox";
        if (subdomain.includes("-")) {
          subdomain = "smm-sandbox"; // Fallback to their known subdomain if they entered a resolved UUID
        }
        
        const workspaceLink = document.getElementById("find-workspace-id-link");
        if (workspaceLink) {
          workspaceLink.href = `https://${subdomain}.atlassian.net/rest/servicedeskapi/assets/workspace`;
        }

        const cloudLink = document.getElementById("find-cloud-id-link");
        if (cloudLink) {
          cloudLink.href = `https://${subdomain}.atlassian.net/_edge/tenant_info`;
        }
      };
      
      // Initialize on modal open and watch for typing changes
      updateHelpLinks();
      cloudIdInput.oninput = updateHelpLinks;
      
      // Render/Fades elements as per current offline mode state
      toggleOfflineUI(isOfflineMode);
    }
  }
}
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("active");
}

// Theme Toggle & Connection Features Initial State Loader
document.addEventListener("DOMContentLoaded", () => {
  const themeBtn = document.getElementById("theme-toggle-btn");
  if (themeBtn) {
    const currentTheme = localStorage.getItem("assetGuard_theme") || "light";
    if (currentTheme === "dark") {
      document.body.setAttribute("data-theme", "dark");
      themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
      document.body.removeAttribute("data-theme");
      themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
  }

  // Bind Telemetry diagnostics tracer trigger
  const runDiagnosticsBtn = document.getElementById("run-diagnostics-btn");
  if (runDiagnosticsBtn) {
    runDiagnosticsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      runConnectionTelemetry();
    });
  }

});

// Run connection diagnostic telemetry tracing
async function runConnectionTelemetry() {
  const panel = document.getElementById("diagnostics-panel");
  const output = document.getElementById("diagnostics-trace-output");
  const timeSpan = document.getElementById("diagnostics-time");
  
  if (!panel || !output) return;
  
  // Toggle active class on panel
  panel.classList.toggle("active");
  if (!panel.classList.contains("active")) return;
  
  timeSpan.textContent = new Date().toLocaleTimeString();
  output.innerHTML = "";
  
  const addLine = (type, text) => {
    const iconMap = {
      info: "fa-info-circle",
      success: "fa-circle-check",
      warning: "fa-triangle-exclamation",
      error: "fa-circle-xmark",
      spin: "fa-spinner fa-spin"
    };
    const line = document.createElement("div");
    line.className = `trace-line ${type}`;
    line.innerHTML = `<i class="fa-solid ${iconMap[type] || 'fa-terminal'}"></i> ${text}`;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  };
  
  addLine("info", "Starting Telemetry Connection diagnostics trace...");
  
  if (isOfflineMode) {
    addLine("warning", "Diagnostics halted: Active Offline Mode is currently enabled. Bypass connection checks.");
    return;
  }
  
  const email = (document.getElementById("api-email")?.value || "").trim() || apiConfig.email;
  const token = (document.getElementById("api-token")?.value || "").trim() || apiConfig.token;
  const cloudId = (document.getElementById("api-cloud-id")?.value || "").trim() || apiConfig.cloudId;
  const workspaceId = (document.getElementById("api-workspace-id")?.value || "").trim() || apiConfig.workspaceId;
  
  // Check Step 1: Config Fields check
  addLine("info", "Verifying Atlassian configurations parameters...");
  await new Promise(r => setTimeout(r, 400));
  
  if (!email || !token || !cloudId || !workspaceId) {
    addLine("error", "Failed: Missing critical Atlassian settings. Please fill out Cloud ID, Workspace ID, Email, and API Token fields.");
    return;
  }
  addLine("success", "Required Atlassian fields are populated.");
  
  // Check Step 2: UUID Format verification
  const isCloudUuid = cloudId.includes("-") && isValidUUID(cloudId);
  const isSubdomain = !cloudId.includes("-");
  
  if (!isCloudUuid && !isSubdomain) {
    addLine("warning", `Cloud ID format '${cloudId}' looks abnormal. UUID or simple subdomain expected.`);
  } else if (isCloudUuid) {
    addLine("success", `Cloud ID format is verified as a valid UUID.`);
  } else {
    addLine("info", `Cloud ID is a raw subdomain '${cloudId}'. Running auto-resolver to fetch UUID...`);
  }
  
  // Check Step 3: Test Live Candidate AQL Endpoints
  const sub = localStorage.getItem("assetGuard_subdomain") || (!cloudId.includes("-") ? cloudId : "");
  
  const candidateUrls = [];
  if (sub) {
    candidateUrls.push(`https://${sub}.atlassian.net/gateway/api/jsm/assets/workspace/${workspaceId}/v1/object/aql`);
    candidateUrls.push(`https://${sub}.atlassian.net/rest/servicedeskapi/assets/workspace/${workspaceId}/v1/object/aql`);
  }
  if (cloudId && cloudId.includes("-")) {
    candidateUrls.push(`https://api.atlassian.com/ex/jira/${cloudId}/jsm/assets/workspace/${workspaceId}/v1/object/aql`);
  }

  addLine("info", `Testing ${candidateUrls.length} candidate Atlassian AQL endpoints...`);
  
  const auth = btoa(`${email}:${token}`);
  const headers = {
    "Authorization": `Basic ${auth}`,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  
  let routeSuccess = false;
  
  for (let idx = 0; idx < candidateUrls.length; idx++) {
    const testUrl = candidateUrls[idx];
    addLine("spin", `[Route ${idx+1}/${candidateUrls.length}] Testing: ${testUrl}`);
    await new Promise(r => setTimeout(r, 400));
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      
      const res = await fetch(`${testUrl}?start=0&limit=1`, {
        method: "POST",
        headers: headers,
        signal: controller.signal,
        body: JSON.stringify({
          qlQuery: "id > 0",
          includeAttributes: false,
          resultsPerPage: 1
        })
      });
      clearTimeout(timeout);
      
      if (res.ok) {
        addLine("success", `Route ${idx+1} SUCCEEDED! HTTP ${res.status} OK! Workspace ID verified.`);
        routeSuccess = true;
        break;
      } else {
        const errText = await res.text().catch(() => "");
        if (res.status === 404) {
          addLine("error", `Route ${idx+1} returned HTTP 404 Not Found. Workspace ID '${workspaceId}' or path invalid on this endpoint.`);
        } else if (res.status === 401 || res.status === 403) {
          addLine("warning", `Route ${idx+1} returned HTTP ${res.status} ${res.statusText}. Check Email & API Token.`);
        } else {
          addLine("warning", `Route ${idx+1} returned HTTP ${res.status}: ${res.statusText}. Snippet: ${errText.substring(0, 100)}`);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        addLine("warning", `Route ${idx+1} timed out after 4s (likely CORS or network firewall).`);
      } else {
        addLine("error", `Route ${idx+1} network error: ${err.message} (CORS block standard on localhost/static).`);
      }
    }
  }
  
  if (!routeSuccess) {
    addLine("warning", "💡 Recommendation: If all direct routes returned 404, verify that your Workspace ID was extracted using '/rest/servicedeskapi/assets/workspace' and NOT from the browser URL address bar.");
  }
  
  addLine("success", "Tracer diagnostics complete. Connection telemetry successfully analyzed.");
}



