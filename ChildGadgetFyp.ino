#include <Arduino.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <Preferences.h>
#include <time.h>

// Define the RX and TX pins for Serial2
#define RXD2 16
#define TXD2 17

#define GPS_BAUD 9600

// TinyGPS++
TinyGPSPlus gps;
WiFiClientSecure client;
Preferences preferences;
String pendingSosEventId;
uint64_t pendingSosTimestamp = 0;
bool pendingSosGpsFix = false;
double pendingSosLat = 0;
double pendingSosLng = 0;

// Create an instance of the HardwareSerial class for Serial 2
// HardwareSerial gpsSerial(1);

unsigned long currentMillis = 0;
unsigned long sendDataPrevMillis = 0;  // to Firebase RTDB

#if __has_include("ChildLinkDeviceConfig.h")
#include "ChildLinkDeviceConfig.h"
#endif
#ifndef CHILDLINK_WIFI_SSID
#define CHILDLINK_WIFI_SSID "SET_WIFI_SSID"
#define CHILDLINK_WIFI_PASSWORD "SET_WIFI_PASSWORD"
#define CHILDLINK_CHILD_ID "SET_CHILD_ID"
#define CHILDLINK_DEVICE_TOKEN "SET_DEVICE_TOKEN"
#endif
#ifndef CHILDLINK_SERVER_ROOT_CA
#error "Add the verified server root CA PEM to ChildLinkDeviceConfig.h; insecure TLS is not allowed."
#endif

// Set these values from the one-time ChildLink device setup shown in the app.
// Never reuse a token between trackers. The token authorizes this device only.
const String CHILD_ID = CHILDLINK_CHILD_ID;
const String DEVICE_TOKEN = CHILDLINK_DEVICE_TOKEN;
const String INGEST_URL = "https://us-central1-smartgrid-abc67.cloudfunctions.net/ingestLocation";
const String TELEMETRY_URL = "https://us-central1-smartgrid-abc67.cloudfunctions.net/ingestTelemetry";

void setup() {
  Serial.begin(115200);

  // Serial2 with defined RX and TX pins
  Serial2.begin(9600, SERIAL_8N1, 16, 17);

  initWiFi();
  client.setCACert(CHILDLINK_SERVER_ROOT_CA);
  preferences.begin("childlink", false);
  pendingSosEventId = preferences.getString("pendingSos", "");
  pendingSosTimestamp = preferences.getULong64("pendingTime", 0);
  pendingSosGpsFix = preferences.getBool("pendingFix", false);
  pendingSosLat = preferences.getDouble("pendingLat", 0);
  pendingSosLng = preferences.getDouble("pendingLng", 0);
  initFirebase();
#ifdef CHILDLINK_SOS_PIN
  pinMode(CHILDLINK_SOS_PIN, INPUT_PULLUP);
#endif

  Serial.println("Ready!");

}

unsigned long pmillis = 0;
String latt = "0", longg = "0";
unsigned long t = 0;
unsigned long sosDebounceAt = 0;
int sosLastReading = HIGH;
int sosStableState = HIGH;

void loop() {
  currentMillis = millis();

  while (Serial2.available() > 0) {
    gps.encode(Serial2.read());
  }

#ifdef CHILDLINK_SOS_PIN
  pollSosButton();
#endif

  if (currentMillis - pmillis > 15000) {

    Serial.print("Satellites: ");
    Serial.println(gps.satellites.value());

    Serial.print("Valid: ");
    Serial.println(gps.location.isValid());

    if (gps.location.isValid()) {
      Serial.print("Lat: ");
      Serial.println(gps.location.lat(), 6);

      Serial.print("Lng: ");
      Serial.println(gps.location.lng(), 6);

      latt = String(gps.location.lat(), 6);
      longg = String(gps.location.lng(), 6);
    }

    const bool freshGpsFix = gps.location.isValid() && gps.location.isUpdated();
    if (freshGpsFix) Write();
    if (sendDeviceTelemetry(freshGpsFix, pendingSosEventId) && pendingSosEventId.length()) {
      clearPendingSos();
    }
    pmillis = currentMillis;
  }

  // if (millis() > 5000 && gps.charsProcessed() < 10) {
  //   Serial.println("No GPS detected.");
  //   delay(1000);
  // }
}

// void displayGPSInfo() {
//   if (gps.location.isValid()) {
//     Serial.println("===== GPS DATA =====");

//     Serial.print("Latitude: ");
//     Serial.println(gps.location.lat(), 6);

//     Serial.print("Longitude: ");
//     Serial.println(gps.location.lng(), 6);

//     Serial.print("Altitude: ");
//     Serial.print(gps.altitude.meters());
//     Serial.println(" m");

//     Serial.print("Speed: ");
//     Serial.print(gps.speed.kmph());
//     Serial.println(" km/h");

//     Serial.print("Satellites: ");
//     Serial.println(gps.satellites.value());

//     Serial.print("HDOP: ");
//     Serial.println(gps.hdop.value());

//     Serial.print("Date: ");
//     Serial.print(gps.date.day());
//     Serial.print("/");
//     Serial.print(gps.date.month());
//     Serial.print("/");
//     Serial.println(gps.date.year());

//     Serial.print("Time (UTC): ");
//     Serial.print(gps.time.hour());
//     Serial.print(":");
//     Serial.print(gps.time.minute());
//     Serial.print(":");
//     Serial.println(gps.time.second());

//     Serial.println();
//   }
// }

// Writes complete JSON to RTDB
void Write() {
  // Called only for a fresh, valid GPS fix. Never publish missing coordinates.
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(client, INGEST_URL);
    http.addHeader("X-ChildLink-Token", DEVICE_TOKEN);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<1024> doc;
    doc["childId"] = CHILD_ID;
    doc["lat"] = gps.location.lat();
    doc["lng"] = gps.location.lng();
    const uint64_t timestamp = currentEpochMillis();
    if (timestamp) doc["timestamp"] = timestamp;

    String payload;
    serializeJson(doc, payload);

    int code = http.POST(payload);
    Serial.printf("\n Location upload HTTP status: %d\n", code);
    if (code > 0) Serial.println(http.getString());

    http.end();
  }
}

bool sendDeviceTelemetry(bool gpsFix, const String& sosEventId) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(client, TELEMETRY_URL);
  http.addHeader("X-ChildLink-Token", DEVICE_TOKEN);
  http.addHeader("Content-Type", "application/json");
  StaticJsonDocument<256> doc;
  doc["childId"] = CHILD_ID;
  const bool eventFix = sosEventId.length() && pendingSosGpsFix;
  const bool includeFix = eventFix || (gpsFix && gps.location.isValid());
  doc["gpsFix"] = includeFix;
  if (eventFix) {
    doc["lat"] = pendingSosLat;
    doc["lng"] = pendingSosLng;
  } else if (includeFix) {
    doc["lat"] = gps.location.lat();
    doc["lng"] = gps.location.lng();
  }
  if (sosEventId.length()) {
    doc["sosEventId"] = sosEventId;
    if (pendingSosTimestamp) doc["timestamp"] = pendingSosTimestamp;
  } else {
    const uint64_t timestamp = currentEpochMillis();
    if (timestamp) doc["timestamp"] = timestamp;
  }
  String payload;
  serializeJson(doc, payload);
  const int code = http.POST(payload);
  Serial.printf("Device telemetry HTTP status: %d\n", code);
  if (code > 0) Serial.println(http.getString());
  http.end();
  return code == 202;
}

void sendSosEvent() {
  if (!pendingSosEventId.length()) {
    pendingSosEventId = "sos_" + String((uint32_t)esp_random(), HEX) + "_" + String(millis(), HEX);
    preferences.putString("pendingSos", pendingSosEventId);
    pendingSosTimestamp = currentEpochMillis();
    if (pendingSosTimestamp) preferences.putULong64("pendingTime", pendingSosTimestamp);
    pendingSosGpsFix = gps.location.isValid() && gps.location.age() <= 30000;
    if (pendingSosGpsFix) {
      pendingSosLat = gps.location.lat();
      pendingSosLng = gps.location.lng();
      preferences.putBool("pendingFix", true);
      preferences.putDouble("pendingLat", pendingSosLat);
      preferences.putDouble("pendingLng", pendingSosLng);
    }
  }
  if (sendDeviceTelemetry(false, pendingSosEventId)) clearPendingSos();
}

void clearPendingSos() {
  pendingSosEventId = "";
  pendingSosTimestamp = 0;
  pendingSosGpsFix = false;
  preferences.remove("pendingSos");
  preferences.remove("pendingTime");
  preferences.remove("pendingFix");
  preferences.remove("pendingLat");
  preferences.remove("pendingLng");
}

#ifdef CHILDLINK_SOS_PIN
void pollSosButton() {
  const int reading = digitalRead(CHILDLINK_SOS_PIN);
  if (reading != sosLastReading) {
    sosLastReading = reading;
    sosDebounceAt = millis();
  }
  if (millis() - sosDebounceAt >= 50 && reading != sosStableState) {
    sosStableState = reading;
    if (sosStableState == LOW) sendSosEvent();
  }
}
#endif

void initWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(CHILDLINK_WIFI_SSID, CHILDLINK_WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");

  unsigned long pmillis = millis();
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
    if (millis() - pmillis > 15000) {
      ESP.restart();
    }
  }

  Serial.print("\nConnected to SSID: ");
  Serial.println(WiFi.SSID());
  Serial.print("Connected with IP: ");
  Serial.println(WiFi.localIP());
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  const unsigned long syncStarted = millis();
  while (time(nullptr) < 1700000000 && millis() - syncStarted < 10000) delay(250);
}

uint64_t currentEpochMillis() {
  const time_t seconds = time(nullptr);
  return seconds >= 1700000000 ? (uint64_t)seconds * 1000ULL : 0;
}

void initFirebase() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(client, INGEST_URL);
    int code = http.GET();
    Serial.println(code == 200 ? "\u2705 ChildLink ingestion service connected" : "\u274C ChildLink service unavailable; deploy functions first");
    http.end();
  }
}
