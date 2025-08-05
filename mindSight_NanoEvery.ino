#include <Wire.h>

#define BLINKM_ADDR 0x09 // Default BlinkM I2C address

String currentState = "";
unsigned long lastStateChange = 0;
byte targetR = 0, targetG = 0, targetB = 0;

void stopBlinkMScript() {
    Wire.beginTransmission(BLINKM_ADDR);
    Wire.write('o');
    Wire.endTransmission();
}

void setBlinkMColor(byte r, byte g, byte b) {
    stopBlinkMScript();
    Wire.beginTransmission(BLINKM_ADDR);
    Wire.write('n');
    Wire.write(r);
    Wire.write(g);
    Wire.write(b);
    Wire.endTransmission();
}

void setup() {
    Serial.begin(115200);
    Wire.begin();
    Serial.println("MindSight NanoEvery Ready");

    pinMode(A3, OUTPUT);
    digitalWrite(A3, HIGH);
    pinMode(A2, OUTPUT);
    digitalWrite(A2, LOW);

    stopBlinkMScript();
    setBlinkMColor(0, 0, 0);
}

void loop() {
    // Handle incoming serial RGB commands
    if (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        int firstComma = cmd.indexOf(',');
        int secondComma = cmd.lastIndexOf(',');
        if (firstComma > 0 && secondComma > firstComma) {
            targetR = (byte)cmd.substring(0, firstComma).toInt();
            targetG = (byte)cmd.substring(firstComma + 1, secondComma).toInt();
            targetB = (byte)cmd.substring(secondComma + 1).toInt();
            lastStateChange = millis();
            Serial.print("Set RGB: ");
            Serial.print(targetR); Serial.print(","); Serial.print(targetG); Serial.print(","); Serial.println(targetB);
        }
    }
/* For cycling through colors, uncomment the following block
    // Smoothly cycle through hues in the color family
    const float cycleSpeed = 0.05; // Slow cycling
    float t = (millis() - lastStateChange) * cycleSpeed / 1000.0;

    byte r = targetR, g = targetG, b = targetB;
    if (targetR == 255 && targetG == 255 && targetB == 0) { // happy (yellow)
        r = 255;
        g = (byte)(220 + 35 * sin(t));
        b = (byte)(20 + 20 * cos(t));
    } else if (targetR == 255 && targetG == 0 && targetB == 0) { // angry (red)
        r = 255;
        g = (byte)(20 + 10 * sin(t));
        b = (byte)(10 + 10 * cos(t));
    } else if (targetR == 0 && targetG == 0 && targetB == 255) { // relaxed (blue)
        r = (byte)(20 + 20 * sin(t));
        g = (byte)(20 + 20 * cos(t));
        b = 255;
    } else if (targetR == 0 && targetG == 255 && targetB == 0) { // bored (green)
        r = (byte)(20 + 20 * sin(t));
        g = 255;
        b = (byte)(20 + 20 * cos(t));
    }*/
    setBlinkMColor(targetR, targetG, targetB); // No color cycling
    //setBlinkMColor(r, g, b); // Color cycling
    delay(80);
}