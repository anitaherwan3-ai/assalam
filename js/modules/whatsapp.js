// WhatsApp Gateway Service & Messaging Formatter
// Mendukung pengiriman Direct API Gateway (Fonnte/Wablas/Custom Webhook) dengan Fallback aman wa.me/

(function(global) {
  "use strict";

  async function postToGateway(endpoint, token, targetPhone, message) {
    if (!endpoint || !targetPhone || !message) {
      throw new Error("Parameter pengiriman WA Gateway tidak lengkap.");
    }
    const cleanPhone = (typeof formatWaNumber === "function") ? formatWaNumber(targetPhone) : targetPhone.replace(/\D/g, "");
    
    // Format JSON generik yang kompatibel dengan gateway WA lokal/cloud (Fonnte, Wablas, atau microservice webhook)
    const payload = {
      target: cleanPhone,
      phone: cleanPhone,
      message: message
    };

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    if (token) {
      headers["Authorization"] = token;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("WA Gateway merespons kode: " + response.status);
    }
    return await response.json();
  }

  function fallbackOpenWaMe(cleanPhone, message) {
    const waUrl = "https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent(message);
    window.open(waUrl, "_blank");
    return waUrl;
  }

  async function dispatchWaMessage(targetPhone, message, settings = {}) {
    const cleanPhone = (typeof formatWaNumber === "function") ? formatWaNumber(targetPhone) : targetPhone.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 9) {
      return { success: false, reason: "Nomor WhatsApp tidak valid." };
    }

    const gatewayUrl = (settings.waGatewayUrl || "").trim();
    const gatewayToken = (settings.waGatewayToken || "").trim();

    // 1. Jika WA Gateway terkonfigurasi, coba kirim via API latar belakang
    if (gatewayUrl) {
      try {
        const result = await postToGateway(gatewayUrl, gatewayToken, cleanPhone, message);
        return { success: true, mode: "gateway", result };
      } catch (err) {
        console.warn("[WA-Gateway] Gagal kirim via gateway, beralih ke wa.me fallback:", err.message);
        // Fallback otomatis ke link wa.me
        const waUrl = fallbackOpenWaMe(cleanPhone, message);
        return { success: true, mode: "fallback_wame", waUrl, warning: err.message };
      }
    }

    // 2. Jika tidak ada gateway khusus yang diatur, gunakan wa.me secara instan seperti biasa
    const waUrl = fallbackOpenWaMe(cleanPhone, message);
    return { success: true, mode: "wame", waUrl };
  }

  global.assalamWaGateway = {
    dispatchWaMessage,
    postToGateway,
    fallbackOpenWaMe
  };

})(typeof window !== "undefined" ? window : globalThis);
