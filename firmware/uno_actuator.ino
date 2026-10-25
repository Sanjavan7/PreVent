/*
 * UNO R3 actuator firmware — bedside ventilation unit
 *
 * Host <-> UNO serial schema (FROZEN, mirrored from contracts/src/serial.ts):
 *   115200 baud, '\n'-terminated lines, comma-delimited key=value, NO JSON.
 *   host -> UNO : STATE,fan=<0|1>,rate=<0-255>,hr=<int>,spo2=<int>,alarm=<0|1>,rgb=<0|1|2>
 *                 SRV,angle=<0-180>
 *   UNO  -> host: READY            (once, after setup)
 *                 HB               (~1/s heartbeat)
 *                 IR,code=<uint32> (each remote keypress)
 *   rgb: 0 = green (healthy), 1 = red (compromised), 2 = amber (patching)
 *
 * NOTE: the Arduino IDE expects a sketch to live in a folder of the same name.
 * When opening in the IDE, accept the prompt to move this file into
 * firmware/uno_actuator/uno_actuator.ino (or keep a copy there).
 *
 * Libraries: LiquidCrystal, Servo (bundled); IRremote v4 (Library Manager).
 *
 * PIN MAP (conflict-free; see plans/PLAN-HW-arduino.md):
 *   D0/D1  USB serial (do not use)
 *   D2     IR receiver OUT                  (IRremote receive pin)
 *   D3     74HC595 ST_CP (latch)            (digital only: Timer2 PWM unused)
 *   D4     passive buzzer                   (tone(), Timer2)
 *   D5     74HC595 SH_CP (clock)
 *   D6     L293D 1,2EN -> fan PWM           (Timer0 PWM)
 *   D7     74HC595 DS (data)
 *   D8/D10/D11  RGB LED  R/G/B              (digital only: no PWM, no timer clash)
 *   D9     servo signal                     (Servo lib, Timer1)
 *   D12/D13 LCD RS / EN
 *   A0-A3  LCD D4-D7
 *   A4/A5  7-seg digit selects (2 digits; see TODO(hw) below)
 *
 * Timer notes: IRremote v4 samples on Timer2 on the UNO, and tone() uses
 * Timer2 as well, so the IR timer is stopped around every beep (documented
 * pattern: IrReceiver.stopTimer(); tone(); ...; IrReceiver.restartTimer()).
 * IR keypresses pressed *during* an audible beep are therefore missed; the
 * beeps are short and only occur while alarm=1.
 *
 * ENABLE_LED_FEEDBACK would blink D13, which is the LCD EN pin, so it is
 * disabled below.
 */

#define NO_LED_FEEDBACK_CODE  // never touch D13 (LCD EN)
#include <IRremote.hpp>
#include <LiquidCrystal.h>
#include <Servo.h>

// ---------------------------------------------------------------- pins ----
const uint8_t PIN_IR       = 2;
const uint8_t PIN_595_LAT  = 3;   // ST_CP
const uint8_t PIN_BUZZER   = 4;
const uint8_t PIN_595_CLK  = 5;   // SH_CP
const uint8_t PIN_FAN_PWM  = 6;   // L293D 1,2EN
const uint8_t PIN_595_DATA = 7;   // DS
const uint8_t PIN_RGB_R    = 8;
const uint8_t PIN_SERVO    = 9;
const uint8_t PIN_RGB_G    = 10;
const uint8_t PIN_RGB_B    = 11;
const uint8_t PIN_LCD_RS   = 12;
const uint8_t PIN_LCD_EN   = 13;
// LCD data: A0..A3 -> D4..D7
const uint8_t PIN_LCD_D4 = A0, PIN_LCD_D5 = A1, PIN_LCD_D6 = A2, PIN_LCD_D7 = A3;

// TODO(hw): bench-test the SKU unknowns first (plan task 1).
//  - RGB LED common anode (1) vs common cathode (0). Common-anode inverts levels.
const bool RGB_COMMON_ANODE = false;
//  - 7-seg digit select polarity. Common-cathode digit: select pin LOW enables it.
const bool SEG_COMMON_CATHODE = true;
//  - The 4-digit 7-seg needs 4 digit-select pins, but only A4/A5 are free once
//    serial/IR/LCD/595/RGB/servo/buzzer/fan are placed. We multiplex 2 digits
//    (hero number = reported SpO2). Tie the other digit selects to their
//    inactive level, or extend via a second 595.
const uint8_t SEG_DIGIT_PINS[] = { A4, A5 };
const uint8_t SEG_NUM_DIGITS = sizeof(SEG_DIGIT_PINS) / sizeof(SEG_DIGIT_PINS[0]);

// ------------------------------------------------------------- tunables ----
const unsigned long SERIAL_BAUD_RATE = 115200UL;
const unsigned long HEARTBEAT_MS     = 1000UL;
const unsigned long IR_DEBOUNCE_MS   = 250UL;
const unsigned long SEG_MUX_US       = 2000UL;  // time per digit when multiplexing
const unsigned int  BUZZ_FREQ_HZ     = 2200;
const unsigned int  BUZZ_ON_MS       = 120;
const unsigned int  BUZZ_PERIOD_MS   = 500;
const uint8_t       LINE_BUF_LEN     = 64;      // longest frame is ~55 chars

// 7-seg segment bytes for digits 0-9, bit order a..g,dp = bit0..bit7 (common cathode).
// TODO(hw): re-map if the 595 outputs QA..QH are wired to segments in a different order.
const uint8_t SEG_DIGITS[10] = {
  0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
};
const uint8_t SEG_BLANK = 0x00;

// -------------------------------------------------------------- state ----
struct DeviceState {
  uint8_t fan;     // 0|1  fan on/off
  uint8_t rate;    // 0..255 PWM duty
  int     hr;      // displayed heart rate
  int     spo2;    // displayed SpO2
  uint8_t alarm;   // 0|1
  uint8_t rgb;     // 0 green, 1 red, 2 amber
};

DeviceState g_state = { 0, 0, 0, 0, 0, 0 };
bool g_stateDirty = true;  // LCD/7-seg need a redraw

LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_EN, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);
Servo servo;

char g_line[LINE_BUF_LEN];
uint8_t g_lineLen = 0;
bool g_lineOverflow = false;

unsigned long g_lastHbMs = 0;
unsigned long g_lastIrMs = 0;

// buzzer bookkeeping
bool g_buzzing = false;
unsigned long g_buzzStartMs = 0;
unsigned long g_buzzCycleMs = 0;

// 7-seg multiplex bookkeeping
uint8_t g_segDigit = 0;
unsigned long g_segLastUs = 0;

// ------------------------------------------------------------- drivers ----

// Fan follows the commanded state. L293D direction inputs are hard-wired
// (IN1=5V, IN2=GND); only EN (D6) is PWM'd. Motor power comes from the
// PSU/9V rail, NEVER from an Arduino pin.
void driveFan(uint8_t fan, uint8_t rate) {
  analogWrite(PIN_FAN_PWM, fan ? rate : 0);
  // TODO(hw): optional "breathing" modulation of `rate` over time (sine) once
  // a fixed duty is verified to move air through the tubing.
}

void writeRgbPin(uint8_t pin, bool on) {
  digitalWrite(pin, (on != RGB_COMMON_ANODE) ? HIGH : LOW);
}

void driveRgb(uint8_t rgb) {
  bool r = false, g = false, b = false;
  switch (rgb) {
    case 0: g = true; break;            // green  = healthy
    case 1: r = true; break;            // red    = compromised
    case 2: r = true; g = true; break;  // amber  = patching
    default: break;
  }
  writeRgbPin(PIN_RGB_R, r);
  writeRgbPin(PIN_RGB_G, g);
  writeRgbPin(PIN_RGB_B, b);
}

// LCD shows the reported vitals.
void driveLcd(const DeviceState &s) {
  char row[17];
  snprintf(row, sizeof(row), "HR %-3d SpO2 %-3d", s.hr, s.spo2);
  lcd.setCursor(0, 0);
  lcd.print(row);
  lcd.setCursor(0, 1);
  lcd.print(s.alarm ? "ALARM ON        " : "ALARM OFF       ");
}

// Silent unless alarm=1. Non-blocking beep cadence; IR timer is paused during
// each beep because tone() and IRremote share Timer2 on the UNO.
void serviceBuzzer(uint8_t alarm) {
  unsigned long now = millis();
  if (!alarm) {
    if (g_buzzing) {
      noTone(PIN_BUZZER);
      IrReceiver.restartTimer();
      g_buzzing = false;
    }
    return;
  }
  if (g_buzzing) {
    if (now - g_buzzStartMs >= BUZZ_ON_MS) {
      noTone(PIN_BUZZER);
      IrReceiver.restartTimer();
      g_buzzing = false;
    }
    return;
  }
  if (now - g_buzzCycleMs >= BUZZ_PERIOD_MS) {
    g_buzzCycleMs = now;
    g_buzzStartMs = now;
    g_buzzing = true;
    IrReceiver.stopTimer();            // free Timer2 for tone()
    tone(PIN_BUZZER, BUZZ_FREQ_HZ);    // silenced by noTone() after BUZZ_ON_MS
  }
}

void shiftSegments(uint8_t pattern) {
  digitalWrite(PIN_595_LAT, LOW);
  shiftOut(PIN_595_DATA, PIN_595_CLK, MSBFIRST, pattern);
  digitalWrite(PIN_595_LAT, HIGH);
}

void selectSegDigit(int8_t idx) {  // idx < 0 -> all off
  for (uint8_t i = 0; i < SEG_NUM_DIGITS; i++) {
    bool enable = (i == (uint8_t)idx);
    digitalWrite(SEG_DIGIT_PINS[i], (enable == SEG_COMMON_CATHODE) ? LOW : HIGH);
  }
}

// Hero number = reported SpO2, right-aligned across SEG_NUM_DIGITS digits.
// Call every loop(); advances one digit every SEG_MUX_US.
void serviceSevenSeg(const DeviceState &s) {
  unsigned long nowUs = micros();
  if (nowUs - g_segLastUs < SEG_MUX_US) return;
  g_segLastUs = nowUs;

  int value = s.spo2 < 0 ? 0 : s.spo2;
  uint8_t digits[SEG_NUM_DIGITS];
  for (int8_t i = SEG_NUM_DIGITS - 1; i >= 0; i--) {
    digits[i] = (uint8_t)(value % 10);
    value /= 10;
  }
  selectSegDigit(-1);  // blank first to avoid ghosting
  g_segDigit = (g_segDigit + 1) % SEG_NUM_DIGITS;
  shiftSegments(SEG_DIGITS[digits[g_segDigit]]);
  selectSegDigit(g_segDigit);
}

void driveServo(int angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  servo.write(angle);
  // TODO(hw): optional "bellows" motion tied to the breathing rhythm.
}

// ------------------------------------------------------------ parsing ----

// Parse "key=value" into *val. Returns false if there is no '='.
bool parseKv(char *tok, const char *key, long *val) {
  char *eq = strchr(tok, '=');
  if (!eq) return false;
  *eq = '\0';
  if (strcmp(tok, key) != 0) return false;
  *val = strtol(eq + 1, NULL, 10);
  return true;
}

long clampLong(long v, long lo, long hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

// STATE,fan=,rate=,hr=,spo2=,alarm=,rgb=   (tokens may arrive in any order)
void handleState(char *rest) {
  DeviceState next = g_state;
  char *saveptr = NULL;
  for (char *tok = strtok_r(rest, ",", &saveptr); tok; tok = strtok_r(NULL, ",", &saveptr)) {
    long v;
    char tmp[24];
    strncpy(tmp, tok, sizeof(tmp) - 1);
    tmp[sizeof(tmp) - 1] = '\0';
    char *eq = strchr(tmp, '=');
    if (!eq) continue;
    v = strtol(eq + 1, NULL, 10);
    *eq = '\0';
    if      (!strcmp(tmp, "fan"))   next.fan   = clampLong(v, 0, 1);
    else if (!strcmp(tmp, "rate"))  next.rate  = clampLong(v, 0, 255);
    else if (!strcmp(tmp, "hr"))    next.hr    = clampLong(v, 0, 999);
    else if (!strcmp(tmp, "spo2"))  next.spo2  = clampLong(v, 0, 999);
    else if (!strcmp(tmp, "alarm")) next.alarm = clampLong(v, 0, 1);
    else if (!strcmp(tmp, "rgb"))   next.rgb   = clampLong(v, 0, 2);
  }
  g_state = next;
  g_stateDirty = true;
  driveFan(g_state.fan, g_state.rate);
  driveRgb(g_state.rgb);
}

// SRV,angle=<0-180>
void handleServo(char *rest) {
  long angle;
  if (parseKv(rest, "angle", &angle)) driveServo((int)angle);
}

void handleLine(char *line) {
  char *saveptr = NULL;
  char *cmd = strtok_r(line, ",", &saveptr);
  if (!cmd) return;
  char *rest = saveptr;  // remainder after first comma ("" if none)
  if (!rest) return;
  if      (!strcmp(cmd, "STATE")) handleState(rest);
  else if (!strcmp(cmd, "SRV"))   handleServo(rest);
  // unknown commands are ignored on purpose
}

// Read bytes into the fixed buffer; dispatch on '\n'. Never blocks.
void pollSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (!g_lineOverflow && g_lineLen > 0) {
        g_line[g_lineLen] = '\0';
        handleLine(g_line);
      }
      g_lineLen = 0;
      g_lineOverflow = false;
      continue;
    }
    if (g_lineLen < LINE_BUF_LEN - 1) {
      g_line[g_lineLen++] = c;
    } else {
      g_lineOverflow = true;  // drop the whole oversize line
    }
  }
}

// ---------------------------------------------------------------- IR ----
// IR,code=<uint32> on each fresh keypress. Repeat frames and empty/unknown
// decodes are ignored; a short debounce suppresses held-button spam.
void pollIr() {
  if (!IrReceiver.decode()) return;
  uint32_t code = (uint32_t)IrReceiver.decodedIRData.decodedRawData;
  bool isRepeat = IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT;
  IrReceiver.resume();  // ready for the next frame
  unsigned long now = millis();
  if (isRepeat || code == 0 || now - g_lastIrMs < IR_DEBOUNCE_MS) return;
  g_lastIrMs = now;
  Serial.print(F("IR,code="));
  Serial.println(code);
}

void serviceHeartbeat() {
  unsigned long now = millis();
  if (now - g_lastHbMs >= HEARTBEAT_MS) {
    g_lastHbMs = now;
    Serial.println(F("HB"));
  }
}

// ------------------------------------------------------------ arduino ----
void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  pinMode(PIN_FAN_PWM, OUTPUT);
  analogWrite(PIN_FAN_PWM, 0);          // fan off until told otherwise

  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);
  driveRgb(0);

  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_595_LAT, OUTPUT);
  pinMode(PIN_595_CLK, OUTPUT);
  pinMode(PIN_595_DATA, OUTPUT);
  for (uint8_t i = 0; i < SEG_NUM_DIGITS; i++) pinMode(SEG_DIGIT_PINS[i], OUTPUT);
  selectSegDigit(-1);
  shiftSegments(SEG_BLANK);

  lcd.begin(16, 2);
  lcd.print(F("PreVent booting"));

  servo.attach(PIN_SERVO);
  driveServo(90);  // TODO(hw): choose neutral angle for the bellows linkage

  IrReceiver.begin(PIN_IR, DISABLE_LED_FEEDBACK);  // D13 is LCD EN

  g_lastHbMs = millis();
  lcd.clear();
  Serial.println(F("READY"));  // once, after setup; host waits for this before sending
}

void loop() {
  pollSerial();
  pollIr();
  serviceBuzzer(g_state.alarm);
  serviceSevenSeg(g_state);
  if (g_stateDirty) {
    driveLcd(g_state);
    g_stateDirty = false;
  }
  serviceHeartbeat();
}
