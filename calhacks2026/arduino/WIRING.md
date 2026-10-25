# ICU-04 bench monitor

The SPA06-003 reads the temperature and the barometric pressure of the air in the room. The page uses those two numbers as the ventilator's temperature and pressure. The fan is the blower. This is a bench demonstration. It is not safe to connect to a person, and the sensor does not measure airway pressure.

Power the Uno from the computer USB cable. Leave the 9 V battery disconnected. Do not power the motor from an Arduino pin. Use a separate regulated 3–6 V supply for the motor, and tie that supply's negative terminal to Arduino GND.

Power the SPA06-003 from the Uno 3.3V pin. Do not use 5V for the sensor until the module itself says it accepts 5V.

## Pins

| Arduino | Connects to |
| :-- | :-- |
| 3.3V | SPA06-003 VCC |
| 5V | LCD pin 2, LCD backlight if the module allows it, contrast-pot outer leg, L293D pin 16 |
| GND | SPA06-003 GND, LCD pins 1, 5, and 16, contrast-pot outer leg, LED cathodes, buzzer negative, L293D ground pins, motor-supply negative |
| A4 | SPA06-003 SDA |
| A5 | SPA06-003 SCL |
| A1 | Red LED through a 220–330 Ω resistor |
| D2 | Green LED through a 220–330 Ω resistor |
| D6 | Yellow LED through a 220–330 Ω resistor |
| D13 | Active buzzer positive |
| D12 | LCD pin 4, RS |
| D11 | LCD pin 6, E |
| D10 | LCD pin 11, D4 |
| D9 | LCD pin 12, D5 |
| D4 | LCD pin 13, D6 |
| D3 | LCD pin 14, D7 |
| LCD pin 3 | Middle leg of the 10 kΩ contrast potentiometer |
| D5 | L293D pin 1, enable |
| D7 | L293D pin 2, input 1 |
| D8 | L293D pin 7, input 2 |
| L293D pin 3 and pin 6 | The two motor wires |
| L293D pin 8 | Motor supply positive, 3–6 V |

The contrast potentiometer's outer legs go to 5V and GND. LCD pins 7–10 stay empty. The L293D sits across the breadboard gap with the notch facing up. Ground pins on the chip are 4, 5, 12, and 13.

## What the sketch reports

`bedside/bedside.ino` prints one JSON line, ten times a second, at 115200 baud.

`temp_c` and `press` come from the SPA06-003, in °C and hPa. `fan` is the speed command sent to the motor driver. `alarm` is 1 when the sensor cannot be read. The fan stops, the red LED lights, and the buzzer sounds until the sensor answers again.

## Bring-up

1. Uno, SPA06-003, and LCD only. Confirm the LCD prints a temperature and a pressure near 1013 hPa, and that the serial monitor shows the same.
2. Add the LEDs and the buzzer.
3. Add the L293D and the motor supply last. The fan speed follows the pressure reading.
