#include <LiquidCrystal.h>
#include <Wire.h>

#define PIN_LED_GREEN  A1   // fan spinning -> green (was red on A1; swapped)
#define PIN_LED_RED    2    // fan stopped  -> red   (D2)
#define PIN_LED_AMBER  6
#define PIN_MOTOR_EN   5
#define PIN_MOTOR_IN1  7
#define PIN_MOTOR_IN2  8
#define PIN_BUZZER     13

LiquidCrystal lcd(12, 11, 10, 9, 4, 3);

#define REG_PSR      0x00
#define REG_TMP      0x03
#define REG_PRS_CFG  0x06
#define REG_TMP_CFG  0x07
#define REG_MEAS_CFG 0x08
#define REG_CFG      0x09
#define REG_RESET    0x0C
#define REG_ID       0x0D
#define REG_COEF     0x10

#define SCALE_8X     7864320.0f
#define PRESS_LO     980.0f
#define PRESS_HI     1040.0f

const unsigned long TX_PERIOD_MS  = 100;
const unsigned long LCD_PERIOD_MS = 500;

struct {
  unsigned long tx  = 0;
  unsigned long lcd = 0;
} last;

struct {
  int32_t c0 = 0, c1 = 0;
  int32_t c00 = 0, c10 = 0;
  int32_t c01 = 0, c11 = 0, c20 = 0, c21 = 0, c30 = 0;
  int32_t c31 = 0, c40 = 0;
  uint8_t addr = 0;
  bool ok = false;
} baro;

struct {
  float tempC = 0;
  float pressure = 0;
} env;

struct {
  uint8_t duty = 0;
  bool missing = true;
  bool band = false;
} out;

int32_t sx12(int32_t v) {
  return (v & 0x800) ? (v | 0xFFFFF000) : v;
}

int32_t sx20(int32_t v) {
  return (v & 0x80000) ? (int32_t)((uint32_t)v | 0xFFF00000) : v;
}

bool writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(baro.addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool readRegs(uint8_t reg, uint8_t *buf, uint8_t n) {
  Wire.beginTransmission(baro.addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)baro.addr, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

bool probe(uint8_t addr) {
  baro.addr = addr;
  uint8_t id = 0;
  if (!readRegs(REG_ID, &id, 1)) return false;
  return id == 0x11;
}

bool loadCoef() {
  uint8_t c[21];
  for (uint8_t off = 0; off < 21; off += 7) {
    if (!readRegs(REG_COEF + off, c + off, 7)) return false;
  }
  baro.c0 = sx12((int32_t)((c[0] << 4) | (c[1] >> 4)));
  baro.c1 = sx12((int32_t)(((c[1] & 0x0F) << 8) | c[2]));
  baro.c00 = sx20((int32_t)(((uint32_t)c[3] << 12) | ((uint16_t)c[4] << 4) | (c[5] >> 4)));
  baro.c10 = sx20((int32_t)((((uint32_t)c[5] & 0x0F) << 16) | ((uint16_t)c[6] << 8) | c[7]));
  baro.c01 = (int16_t)((c[8] << 8) | c[9]);
  baro.c11 = (int16_t)((c[10] << 8) | c[11]);
  baro.c20 = (int16_t)((c[12] << 8) | c[13]);
  baro.c21 = (int16_t)((c[14] << 8) | c[15]);
  baro.c30 = (int16_t)((c[16] << 8) | c[17]);
  baro.c31 = sx12((int32_t)((c[18] << 4) | (c[19] >> 4)));
  baro.c40 = sx12((int32_t)(((c[19] & 0x0F) << 8) | c[20]));
  return true;
}

bool startBaro() {
  if (!probe(0x77) && !probe(0x76)) return false;
  writeReg(REG_RESET, 0x09);
  delay(50);
  unsigned long wait = millis();
  uint8_t cfg = 0;
  while (millis() - wait < 200) {
    if (readRegs(REG_MEAS_CFG, &cfg, 1) && (cfg & 0xC0) == 0xC0) break;
    delay(10);
  }
  if (!loadCoef()) return false;
  writeReg(REG_PRS_CFG, 0x43);
  writeReg(REG_TMP_CFG, 0x43);
  writeReg(REG_CFG, 0x00);
  writeReg(REG_MEAS_CFG, 0x07);
  return true;
}

int32_t sign24(uint32_t v) {
  if (v & 0x800000) v |= 0xFF000000;
  return (int32_t)v;
}

bool sampleBaro() {
  uint8_t raw[6];
  if (!readRegs(REG_PSR, raw, 6)) return false;
  int32_t praw = sign24(((uint32_t)raw[0] << 16) | ((uint32_t)raw[1] << 8) | raw[2]);
  int32_t traw = sign24(((uint32_t)raw[3] << 16) | ((uint32_t)raw[4] << 8) | raw[5]);
  float psc = (float)praw / SCALE_8X;
  float tsc = (float)traw / SCALE_8X;
  float p2 = psc * psc;
  float p3 = p2 * psc;
  float p4 = p3 * psc;
  env.tempC = (float)baro.c0 * 0.5f + (float)baro.c1 * tsc;
  float pascals =
      (float)baro.c00 + (float)baro.c10 * psc + (float)baro.c20 * p2 +
      (float)baro.c30 * p3 + (float)baro.c40 * p4 +
      tsc * ((float)baro.c01 + (float)baro.c11 * psc + (float)baro.c21 * p2 + (float)baro.c31 * p3);
  env.pressure = pascals / 100.0f;
  if (env.pressure < 300.0f || env.pressure > 1200.0f) return false;
  if (env.tempC < -40.0f || env.tempC > 85.0f) return false;
  return true;
}

void runMotor(uint8_t duty) {
  out.duty = duty;
  if (duty == 0) {
    digitalWrite(PIN_MOTOR_IN1, LOW);
    digitalWrite(PIN_MOTOR_IN2, LOW);
    analogWrite(PIN_MOTOR_EN, 0);
    return;
  }
  digitalWrite(PIN_MOTOR_IN1, HIGH);
  digitalWrite(PIN_MOTOR_IN2, LOW);
  analogWrite(PIN_MOTOR_EN, duty);
}

// The indicator LEDs sit on fixed resistors on non-PWM pins (A1/D2/D6), so
// analogWrite can't dim them. Instead we gate them HIGH only inside a fast 50%
// window (250 Hz, well above flicker) -> ~half brightness. Lower LED_ON_US to
// dim further.
#define LED_PWM_US 4000UL
#define LED_ON_US  2000UL

void driveOutputs() {
  out.band = env.pressure < PRESS_LO || env.pressure > PRESS_HI;
  if (out.missing) {
    runMotor(0);
  } else {
    int duty = map((int)env.pressure, (int)PRESS_LO, (int)PRESS_HI, 170, 210);
    runMotor((uint8_t)constrain(duty, 170, 210));
  }

  bool spinning = out.duty > 0;                     // fan actually commanded on
  bool dim = (micros() % LED_PWM_US) < LED_ON_US;   // ~half-brightness gate

  // Green when the fan spins, red when it's stopped — both dimmed.
  digitalWrite(PIN_LED_GREEN, (spinning && dim) ? HIGH : LOW);
  digitalWrite(PIN_LED_RED,   (!spinning && dim) ? HIGH : LOW);
  digitalWrite(PIN_LED_AMBER, (spinning && out.band && dim) ? HIGH : LOW);

  // Active buzzer (on/off only) — keep it quiet with a short ~120 ms beep each
  // second while the fan is down, instead of a continuous blare.
  bool beep = (millis() % 1000UL) < 120UL;
  digitalWrite(PIN_BUZZER, (!spinning && beep) ? HIGH : LOW);
}

void shipFrame() {
  float shownT = out.missing ? 0.0f : env.tempC;
  float shownP = out.missing ? 0.0f : env.pressure;
  Serial.print(F("{\"t\":"));
  Serial.print(millis());
  Serial.print(F(",\"temp_c\":"));
  Serial.print(shownT, 1);
  Serial.print(F(",\"press\":"));
  Serial.print(shownP, 1);
  Serial.print(F(",\"fan\":"));
  Serial.print(out.duty);
  Serial.print(F(",\"alarm\":"));
  Serial.print(out.missing ? 1 : 0);
  Serial.println(F("}"));
}

void paintLcd() {
  lcd.setCursor(0, 0);
  lcd.print("T:");
  if (out.missing) lcd.print("--.-");
  else {
    if (env.tempC < 10) lcd.print(' ');
    lcd.print(env.tempC, 1);
  }
  lcd.print((char)223);
  lcd.print("C       ");

  lcd.setCursor(0, 1);
  lcd.print("P:");
  if (out.missing) lcd.print("----");
  else lcd.print(env.pressure, 1);
  lcd.print(" F:");
  if (out.duty < 100) lcd.print(' ');
  if (out.duty < 10) lcd.print(' ');
  lcd.print(out.duty);
  lcd.print(out.missing ? " !" : "  ");
}

bool due(unsigned long now, unsigned long &stamp, unsigned long period) {
  if (now - stamp < period) return false;
  stamp = now;
  return true;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  delay(300);

  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_AMBER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_MOTOR_IN1, OUTPUT);
  pinMode(PIN_MOTOR_IN2, OUTPUT);
  runMotor(0);

  baro.ok = startBaro();
  out.missing = !baro.ok;

  lcd.begin(16, 2);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(baro.ok ? "SPA06 ready" : "SPA06 missing");
  lcd.setCursor(0, 1);
  lcd.print("ICU-04 bench");
  delay(900);
  lcd.clear();
}

void loop() {
  unsigned long now = millis();
  if (baro.ok) out.missing = !sampleBaro();
  driveOutputs();
  if (due(now, last.lcd, LCD_PERIOD_MS)) paintLcd();
  if (due(now, last.tx, TX_PERIOD_MS)) shipFrame();
}
