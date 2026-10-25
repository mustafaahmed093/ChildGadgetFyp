#include <Arduino.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// Define the RX and TX pins for Serial2
#define RXD2 16
#define TXD2 17

#define GPS_BAUD 9600

// TinyGPS++
TinyGPSPlus gps;
WiFiClientSecure client;

// Create an instance of the HardwareSerial class for Serial 2
// HardwareSerial gpsSerial(1);

unsigned long currentMillis = 0;
unsigned long sendDataPrevMillis = 0;  // to Firebase RTDB

// Insert your network credentials
#define WIFI_SSID "CHILD"
#define WIFI_PASSWORD "12345678"

// Insert Firebase project API Key
const String API_KEY = "AIzaSyDfrZ05Eqm5YYYOb3odYELj6dasJnZQfLU";  // Replace with your Firebase Auth Token
// Insert RTDB URLefine the RTDB URL */
const String DATABASE_URL = "https://smartgrid-abc67-default-rtdb.firebaseio.com/";  // Replace with your Firebase URL
bool signupOK = false;

void setup() {
  Serial.begin(115200);

  // Serial2 with defined RX and TX pins
  Serial2.begin(9600, SERIAL_8N1, 16, 17);

  initWiFi();
  client.setInsecure();  // Use insecure mode for HTTPS
  initFirebase();

  Serial.println("Ready!");

}

unsigned long pmillis = 0;
String latt = "0", longg = "0";
unsigned long t = 0;

void loop() {
  currentMillis = millis();

  while (Serial2.available() > 0) {
    gps.encode(Serial2.read());
  }

  if (currentMillis - pmillis > 3500) {

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

    Write();
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
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = DATABASE_URL + "Data.json?auth=" + API_KEY;
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<1024> doc;
    doc["latt"] = latt;
    doc["longg"] = longg;

    String payload;
    serializeJson(doc, payload);

    int code = http.PATCH(payload);
    Serial.printf("\n PATCH Code: %d\n", code);

    http.end();
  }
}

void initWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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
}

void initFirebase() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = DATABASE_URL + ".json?auth=" + API_KEY;
    http.begin(client, url);
    int code = http.GET();
    Serial.println(code == 200 ? "\u2705 Firebase Connected!" : "\u274C Firebase Not Connected!");
    http.end();
  }
}
