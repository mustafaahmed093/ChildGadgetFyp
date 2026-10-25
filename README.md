# ChildGadgetFyp — ESP32 GPS Child Tracker

ESP32-based child tracking device that reads GPS coordinates and sends them live to Firebase Realtime Database every 3.5 seconds.

---

## Required Arduino Libraries

Install these via **Arduino IDE → Sketch → Include Library → Manage Libraries**:

| Library | Version (recommended) |
|---|---|
| `TinyGPS++` by Mikal Hart | Latest |
| `ArduinoJson` by Benoit Blanchon | v6.x |

These are **built-in** with the ESP32 board package (no separate install needed):
- `WiFi.h`
- `HTTPClient.h`
- `WiFiClientSecure.h`

---

## ESP32 Board Setup in Arduino IDE

1. Open Arduino IDE
2. Go to **File → Preferences**
3. In *Additional Board Manager URLs*, add:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. Go to **Tools → Board → Boards Manager**
5. Search `esp32` → Install **esp32 by Espressif Systems**
6. Go to **Tools → Board → ESP32 Arduino → ESP32 Dev Module**
7. Set **Upload Speed**: `115200`
8. Select the correct **Port** (e.g. `COM3` on Windows, `/dev/ttyUSB0` on Linux)

---

## GPS Module Wiring (NEO-6M / NEO-8M → ESP32)

| GPS Module Pin | ESP32 Pin |
|---|---|
| VCC | 3.3V or 5V |
| GND | GND |
| TX | GPIO 16 (RX2) |
| RX | GPIO 17 (TX2) |

> GPS communicates via Serial2 at **9600 baud**.

---

## WiFi Credentials

Located at the **top of `ChildGadgetFyp.ino`**:

```cpp
#define WIFI_SSID     "CHILD"
#define WIFI_PASSWORD "12345678"
```

Change these to match your WiFi network before uploading.

---

## Firebase Setup

### What's needed:
- A **Firebase project** with **Realtime Database** enabled
- Database rules set to allow read/write (for testing):
  ```json
  {
    "rules": {
      ".read": true,
      ".write": true
    }
  }
  ```

### Where credentials are in the code:

```cpp
const String API_KEY     = "AIzaSyDfrZ05Eqm5YYYOb3odYELj6dasJnZQfLU";
const String DATABASE_URL = "https://smartgrid-abc67-default-rtdb.firebaseio.com/";
```

Replace both values with your own Firebase project's **Web API Key** and **RTDB URL**.

---

## How to Upload / Run in Arduino IDE

1. Open `ChildGadgetFyp.ino` in Arduino IDE
2. Update WiFi credentials and Firebase keys (if using your own project)
3. Connect ESP32 to PC via USB
4. Select the correct **Board** and **Port** (see Board Setup above)
5. Click **Upload** (→ arrow button)
6. Wait for `Done uploading.` message

---

## How to Check Output (Serial Monitor)

1. After uploading, go to **Tools → Serial Monitor**
2. Set baud rate to **115200**
3. You should see:

```
Connecting to WiFi....
Connected to SSID: CHILD
Connected with IP: 192.168.x.x
✅ Firebase Connected!
Ready!
Satellites: 4
Valid: 1
Lat: 3.123456
Lng: 101.654321

 PATCH Code: 200
```

- `PATCH Code: 200` = data successfully written to Firebase
- `Valid: 0` = GPS has no satellite fix yet (go outdoors or near a window)

---

## Where Firebase Data is Saved

Data is written to this path in your Realtime Database:

```
Data/
├── latt   → "3.123456"
└── longg  → "101.654321"
```

You can view it live at:
```
https://your-project-id-default-rtdb.firebaseio.com/Data.json
```

---

## Notes

- If GPS has no fix, `latt` and `longg` will be sent as `"0"` to Firebase
- ESP32 auto-restarts if WiFi connection fails within 15 seconds
- `client.setInsecure()` is used — SSL certificate is not verified (suitable for development/testing)
