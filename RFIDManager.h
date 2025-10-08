#pragma once
#include <Arduino.h>
#include <MFRC522.h>
#include <SPI.h>

class RFIDManager {
public:
    RFIDManager(int ssPin, int rstPin);
    void begin();
    bool isCardDetected();
    bool readUID(String &uidOut);

private:
    MFRC522 rfid;
    int ssPin, rstPin;
};