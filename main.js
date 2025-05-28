const { app, Tray, Menu, globalShortcut, Notification, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const Store = require("electron-store");
const log = require("electron-log");
const AutoLaunch = require("auto-launch");
const { rmSync } = require("fs");
const { join } = require("path");
const os = require("os");

const store = new Store();
const trayIconPath = path.join(__dirname, "assets", "icon.png");
const logFile = path.join(app.getPath("userData"), "alarm-log.json");
let tray = null;

// AutoLaunch ayarı
const autoLauncher = new AutoLaunch({
  name: "Grikod Alarm",
  path: app.getPath("exe"),
});

autoLauncher.enable().catch(() => {
  console.log("⚠️ Otomatik başlatılamadı ama sorun değil.");
});

// IP alma
function getPublicIP() {
  return new Promise((resolve, reject) => {
    https.get("https://api.ipify.org?format=json", res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ip);
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", reject);
  });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const config of iface) {
      if (config.family === "IPv4" && !config.internal) {
        return config.address;
      }
    }
  }
  return "127.0.0.1";
}

// İnternet kontrolü
function internetVarMi() {
  return new Promise(resolve => {
    require("dns").lookup("google.com", err => resolve(!err));
  });
}

// Alarm loglama
function logAlarm(data) {
  let logs = [];
  if (fs.existsSync(logFile)) {
    logs = JSON.parse(fs.readFileSync(logFile, "utf8"));
  }
  logs.push(data);
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2), "utf8");
}

// Alarm gönderme
async function sendAlarm() {
  if (!(await internetVarMi())) {
    new Notification({ title: "Bağlantı Hatası", body: "📡 İnternet bağlantısı yok." }).show();
    return;
  }

  const config = store.get("config");
  if (!config) return;

  try {
    const ip = getLocalIP();
    const now = new Date().toISOString();

    const postData = JSON.stringify({
      mahalAdi: config.mahalAdi,
      mahalKodu: config.mahalKodu,
      mesaj: "griKodAlarmi",
      ip,
      zaman: now
    });

    const options = {
      hostname: "10.85.1.77",
      port: 3000,
      path: "/grikod-calistir",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, res => {
      console.log(`✅ Gönderildi: ${res.statusCode}`);
      new Notification({ title: "Alarm Gönderildi", body: "✅ Alarm başarıyla gönderildi." }).show();
      logAlarm({ mahalAdi: config.mahalAdi, ip, zaman: now });
    });

    req.on("error", err => {
      log.error("POST Hatası:", err);
      new Notification({ title: "Gönderim Hatası", body: "❌ Alarm gönderilemedi!" }).show();
    });

    req.write(postData);
    req.end();
  } catch (err) {
    new Notification({ title: "IP Hatası", body: "❌ IP alınamadı!" }).show();
  }
}

// İlk kurulum soruları
function ilkKurulumSorusu() {
  return new Promise(resolve => {
    const prompt = require("electron-prompt");
    prompt({
      title: "Mahal Adi",
      label: "Mahal Adi:",
      inputAttrs: { type: "text", name: "mahalAdi" },
      type: "input"
    }).then(mahalAdi => {
      if (!mahalAdi) return app.quit();
      prompt({
        title: "Mahal Kodu",
        label: "Mahal Kodu:",
        inputAttrs: { type: "text", name: "mahalKodu" },
        type: "input"
      }).then(mahalKodu => {
        if (!mahalKodu) return app.quit();
        store.set("config", { mahalAdi, mahalKodu });
        resolve();
      });
    });
  });
}

// Uygulama başlatıldığında
app.whenReady().then(async () => {
  if (!store.get("config")) {
    await ilkKurulumSorusu();
  }

  // ikon resmi yükleniyor
  let trayIconImage = null;
  if (fs.existsSync(trayIconPath)) {
    trayIconImage = nativeImage.createFromPath(trayIconPath);
    if (trayIconImage.isEmpty()) {
      console.warn("⚠️ icon.ico dosyası bozuk veya okunamıyor.");
      trayIconImage = null;
    }
  } else {
    console.warn("⚠️ icon.ico dosyası bulunamadı:", trayIconPath);
  }

  if (trayIconImage && !trayIconImage.isEmpty()) {
    tray = new Tray(trayIconImage);
  } else {
    tray = new Tray(nativeImage.createEmpty()); // Boş ama geçerli bir ikon
  }
  const contextMenu = Menu.buildFromTemplate([
    { label: "Alarm Gönder", click: () => sendAlarm() },
    { label: "Çıkış", click: () => app.quit() }
  ]);

  tray.setToolTip("Mahal Alarm");
  tray.setContextMenu(contextMenu);

  globalShortcut.register("CommandOrControl+Shift+M", () => {
    sendAlarm();
  });
});

// Kapatılırken
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});