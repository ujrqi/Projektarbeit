#include <WiFi.h>
#include <WebServer.h>
#include <time.h>
#include <vector>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Preferences.h>  //NVS
#include <esp_sleep.h>  // Deep Sleep Mode


#include "DisplayManager.h"
#include "RFIDManager.h"

//WLAN-CONNECTION
const char* WIFI_SSID = "KIT-IoT";
const char* WIFI_PASS = "AY4v8UM0yvNCy3k8zZlgv7QG";

//NVS (Non volatile Storage)
Preferences prefs;
unsigned long lastPersistMs = 0;                 
const unsigned long PERSIST_COOLDOWN = 3000;     // ms


// Taster at GPIO33 (RTC).
#define BUTTON_PIN   33
#define BUTTON_RTC   GPIO_NUM_33

//Global declarations
DisplayManager displayManager;
RFIDManager rfidManager(21, 2);   // CS=21, RST=2

std::vector<Person> people;
String roomText = "324";
String lastDate = "";

WebServer server(80);
int layoutOverride = 0;


// Deep Sleep Modus
const unsigned long SLEEP_TIMEOUT_MS = 60000;

unsigned long lastActivityMs = 0;

static inline void touchActivity() { lastActivityMs = millis(); }

static void goToSleep() {
  // Configure wake-up by LOW button (EXT0)
  esp_sleep_enable_ext0_wakeup(BUTTON_RTC, 1); // 0 = LOW

  Serial.println("-> Deep Sleep");
  delay(50);
  esp_deep_sleep_start();
}


//RFID helpers
String normalizeUID(const String& raw) {
  String out; out.reserve(raw.length());
  for (size_t i = 0; i < raw.length(); ++i) {
    char c = raw[i];
    if (isxdigit((unsigned char)c)) out += (char)toupper((unsigned char)c);
  }
  return out;
}

int findPersonIndexByUID(const String& uid) {
  for (size_t i = 0; i < people.size(); ++i)
    if (people[i].uid.equalsIgnoreCase(uid)) return (int)i;
  return -1;
}

//Helpers date
static String getCurrentDate() {
  struct tm ti;
  if (!getLocalTime(&ti)) return lastDate.length() ? lastDate : String("??.??.????");
  char buf[11];
  strftime(buf, sizeof(buf), "%d.%m.%Y", &ti);
  return String(buf);
}

// Returns true if the state is an RFID-blocking override
static bool isOverrideStatus(const String& s) {
  return s.equalsIgnoreCase("On Vacation")
      || s.equalsIgnoreCase("In a Meeting")
      || s.equalsIgnoreCase("Out of Office");
}

static void connectWiFiAndSyncTime() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? "\nWiFi OK" : "\nWiFi fallo/timeout");
  Serial.print("IP: ");      Serial.println(WiFi.localIP());


  // Time zone Europe/Berlin (automatic time change)
  setenv("TZ", "CET-1CEST,M3.5.0/2,M10.5.0/3", 1);
  tzset();

  // NTP (no offsets, handled by TZ)
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  struct tm ti;
  for (int i = 0; i < 20; ++i) {
    if (getLocalTime(&ti)) break;
    delay(200);
  }
}

//Layout picker 
static LayoutType pickLayout(size_t n) {
  if (n <= 1) return LayoutType::Display1;
  if (n == 2) return LayoutType::Display2;
  return LayoutType::Display3; // 3 o más (mostramos 3 primeras)
}

//API HTTP (CORS + JSON) 
static void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}
static void handleOptions() { sendCors(); server.send(204); }

static void sendStateJson() {
  StaticJsonDocument<1536> doc;
  doc["room"] = roomText;
  doc["layout"] = (layoutOverride > 0) ? layoutOverride : (int)pickLayout(people.size());
  JsonArray arr = doc.createNestedArray("people");
  for (size_t i = 0; i < people.size(); ++i) {
    JsonObject o = arr.createNestedObject();
    o["name"]   = people[i].name;
    o["role"]   = people[i].role;
    o["status"] = people[i].status;
    o["uid"]    = people[i].uid;
  }
  String out; serializeJson(doc, out);
  sendCors(); server.send(200, "application/json", out);
}

static bool applyStateFromJson(const String& body, String& err) {
  StaticJsonDocument<2048> doc;
  DeserializationError e = deserializeJson(doc, body);
  if (e) { err = e.c_str(); return false; }

  if (doc.containsKey("room")) {
    roomText = (const char*)doc["room"];
  }

  if (doc.containsKey("people")) {
    std::vector<Person> compact;
    JsonArray arr = doc["people"].as<JsonArray>();

    for (JsonVariant v : arr) {
      JsonObject o = v.as<JsonObject>();
      String name   = o["name"]   | "";
      String role   = o["role"]   | "";
      String status = o["status"] | "";
      String uid    = o["uid"]    | "";

      // Empty => not added (does not count for layout)
      if (name.length() == 0 && role.length() == 0) continue;

      // Build person, preserving status/uid if they already existed
      Person p;
      p.name = name;
      p.role = role;

      int prevIdx = -1;
      if (uid.length() > 0) {
        prevIdx = findPersonIndexByUID(uid);
      }
      if (prevIdx < 0) {
        for (size_t k = 0; k < people.size(); ++k) {
          if (people[k].name == name && people[k].role == role) { prevIdx = (int)k; break; }
        }
      }

      if (status.length() > 0)       p.status = status;
      else if (prevIdx >= 0)         p.status = people[prevIdx].status;
      else                           p.status = "Absent";

      p.uid = uid.length() > 0 ? uid : (prevIdx >= 0 ? people[prevIdx].uid : "");

      compact.push_back(p);
    }

    // Replaces: now people has 1, 2, or 3 ACTUAL entries
    people.swap(compact);
  }

  return true;
}

static void handleGetState() {
  touchActivity();
  sendStateJson();
}


// NVS Save { room, people[] } as JSON data 
static bool saveStateToNVS() {
  StaticJsonDocument<2048> doc;
  doc["room"] = roomText;
  JsonArray arr = doc.createNestedArray("people");
  for (const auto& p : people) {
    JsonObject o = arr.createNestedObject();
    o["name"]   = p.name;
    o["role"]   = p.role;
    o["status"] = p.status;
    o["uid"]    = p.uid;
  }
  String json; serializeJson(doc, json);

  if (!prefs.begin("door", false)) {
    Serial.println("NVS: begin(write) failed");
    return false;
  }
  size_t w = prefs.putString("state", json);
  prefs.end();
  Serial.printf("NVS: saved %u bytes\n", (unsigned)w);
  return w > 0;
}

// Loads { room, people[] } from NVS (no drawing) LUIS
static bool loadStateFromNVS() {
  if (!prefs.begin("door", true)) {
    Serial.println("NVS: begin(read) failed");
    return false;
  }
  String json = prefs.getString("state", "");
  prefs.end();

  if (json.length() == 0) {
    Serial.println("NVS: empty");
    return false;
  }

  String err;
  people.clear(); 
  bool ok = applyStateFromJson(json, err);
  if (!ok) {
    Serial.print("NVS JSON invalid: "); Serial.println(err);
    people.clear();
    return false;
  }
  Serial.printf("NVS: loaded %d persons\n", (int)people.size());
  return true;
}


// Reads an RFID tag for ~8s and returns { “uid”: “HEX” } or 204 if nothing was read
static void handleReadTag() {
  touchActivity();
  // CORS
  sendCors();

  // Timeout in ms: /api/read_tag?t=8000 
  int timeoutMs = 8000;
  if (server.hasArg("t")) {
    int t = server.arg("t").toInt();
    if (t > 0 && t <= 30000) timeoutMs = t;
  }

  unsigned long deadline = millis() + (unsigned long)timeoutMs;

  String rawUid;
  while ((long)(deadline - millis()) > 0) {
    if (rfidManager.readUID(rawUid)) {
      String uid = normalizeUID(rawUid);

      // Releases the RFID SPI bus so as not to block the EPD
      pinMode(21, OUTPUT);
      digitalWrite(21, HIGH);

      // JSON
      String out = String("{\"uid\":\"") + uid + "\"}";
      server.send(200, "application/json", out);
      return;
    }
    delay(50);
  }

  // Nothing read within the timeout
  server.send(204); // No Content
}

static void handlePostState() { 
  touchActivity();
  String body = server.arg("plain");
  String err;
  if (!applyStateFromJson(body, err)) {
    sendCors(); server.send(400, "text/plain", "JSON invalido: " + err); return;
  }

  // Release the RFID reader from the SPI bus before painting  
  pinMode(21, OUTPUT);
  digitalWrite(21, HIGH);

  lastDate = getCurrentDate();
  LayoutType lay = pickLayout(people.size());
  displayManager.drawLayout(lay, roomText, lastDate, people);

  // Mantains NVS and prepares futures partials
  saveStateToNVS();
  displayManager.primeLayout(lay, people);

  sendCors(); server.send(200, "application/json", "{\"ok\":true}");
}


static void startHttpServer() {
  // Routes
  server.on("/api/state", HTTP_OPTIONS, handleOptions);
  server.on("/api/state", HTTP_GET,     handleGetState);
  server.on("/api/state", HTTP_POST,    handlePostState);

  server.on("/api/ping", HTTP_GET, []() {
    sendCors();
    server.send(200, "application/json", "{\"pong\":true}");
    
  });
  server.on("/api/read_tag", HTTP_OPTIONS, handleOptions);  //Read RFID-TAG
  server.on("/api/read_tag", HTTP_GET,     handleReadTag);  //Uploads UID to website
  server.onNotFound([]() {
    sendCors();
    server.send(404, "text/plain", "Not found");
  });
  server.begin();
}

void setup() {
  Serial.begin(115200);
  delay(100);

  // Taster pull-up (active LOW)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  connectWiFiAndSyncTime();
  lastDate = getCurrentDate();

  displayManager.begin();
  rfidManager.begin();

  // No redraw or clear on startup (preserve e-paper)
  // people.clear();
  // displayManager.drawLayout(pickLayout(people.size()), roomText, lastDate, people);

  // Load last persisted state (if it exists) and prepare partials
  if (loadStateFromNVS()) {
    LayoutType lay = pickLayout(people.size());

    // 1 FULL REFRESH on start to resynchronize database 
    // (Prevents loss of the frame buffer when resetting, meaning that elements such as Datum, logo, etc. are not lost)
    displayManager.drawLayout(lay, roomText, lastDate, people);

    displayManager.primeLayout(lay, people);
  }

  // mDNS (independent of loadStateFromNVS)
  if (MDNS.begin("display1")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("mDNS: http://display1.local");
  }

  //  HTTP Server
  startHttpServer();
  Serial.print("HTTP ready in http://");
  Serial.println(WiFi.localIP());

  // Activity window
  touchActivity();
}

unsigned long lastRFIDms = 0;
const unsigned long RFID_COOLDOWN = 700; // ms

void loop() {
  server.handleClient();

// RFID: toggles Present/Absent for the person associated with the UID
String rawUid;
if (rfidManager.readUID(rawUid)) {
  unsigned long now = millis();
  if (now - lastRFIDms > RFID_COOLDOWN) {
    lastRFIDms = now;

    String uid = normalizeUID(rawUid);
    int idx = findPersonIndexByUID(uid);

    if (idx >= 0) {
      // If special status, ignore the RFID.
      if (isOverrideStatus(people[idx].status)) {
        Serial.printf("UID %s ignorado: estado fijo \"%s\"\n",
                      uid.c_str(), people[idx].status.c_str());
        return; 
      }

      people[idx].status = (people[idx].status == "Present") ? "Absent" : "Present";
      Serial.printf("UID %s -> %s = %s\n",
                    uid.c_str(), people[idx].name.c_str(), people[idx].status.c_str());

      // Release RFID from the bus before painting.
      pinMode(21, OUTPUT);
      digitalWrite(21, HIGH);

      // Refresco parcial del status
      displayManager.showStatusPartial(idx, people[idx].status);

      // Persistir con cooldown (lo que ya tenías)
      if (now - lastPersistMs > PERSIST_COOLDOWN) {
        saveStateToNVS();
        lastPersistMs = now;
      }
    } else {
      Serial.printf("UID %s no asignado\n", uid.c_str());
    }
  }
}

  if (millis() - lastActivityMs > SLEEP_TIMEOUT_MS) {     //If no activity in SLEEP_TIMEOUT_MS, dann Sleep
    goToSleep();
  }
}

