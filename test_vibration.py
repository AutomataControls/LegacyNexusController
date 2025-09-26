#!/usr/bin/env python3
import serial
import binascii
import struct
import time
import sys

def test_sensor(port='/dev/ttyUSB0', baudrate=9600, modbus_id=0x50):
    """Test vibration sensor communication"""
    print(f"Testing sensor on {port} at {baudrate} baud, ID: {hex(modbus_id)}")

    try:
        ser = serial.Serial(
            port=port,
            baudrate=baudrate,
            timeout=2.0,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            bytesize=serial.EIGHTBITS
        )

        if ser.is_open:
            print(f"Serial port {ser.name} is open")

        # Build command: ID + Function + Start + Count + CRC
        # Reading from register 0x34, count 0x0C (12 registers)
        hex_string = '50030034000C0980'
        data_to_send = binascii.unhexlify(hex_string)

        print(f"Sending command: {hex_string}")
        ser.write(data_to_send)

        # Wait for response
        time.sleep(0.5)

        # Try to read response
        response = ser.read(29)  # Expected 29 bytes response

        if response:
            response_hex = binascii.hexlify(response).decode('utf-8')
            print(f"Received {len(response)} bytes: {response_hex}")

            if len(response) >= 29:
                print("Success! Sensor responded with expected data length")

                # Parse first 3 registers (acceleration data)
                data_bytes = response[3:9]
                ax = struct.unpack('>h', data_bytes[0:2])[0] / 32768.0 * 16.0
                ay = struct.unpack('>h', data_bytes[2:4])[0] / 32768.0 * 16.0
                az = struct.unpack('>h', data_bytes[4:6])[0] / 32768.0 * 16.0

                print(f"Acceleration X: {ax:.3f}g")
                print(f"Acceleration Y: {ay:.3f}g")
                print(f"Acceleration Z: {az:.3f}g")
            else:
                print(f"Partial response received ({len(response)} bytes)")
        else:
            print("No response from sensor - timeout")

        ser.close()
        print(f"Serial port {ser.name} closed")

    except serial.SerialException as e:
        print(f"Serial error: {e}")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False

    return True

if __name__ == '__main__':
    # Test different configurations
    configs = [
        ('/dev/ttyUSB0', 9600),
        ('/dev/ttyUSB0', 230400),
        ('/dev/ttyUSB2', 9600),
        ('/dev/ttyUSB2', 230400)
    ]

    for port, baud in configs:
        print(f"\n{'='*50}")
        if test_sensor(port, baud):
            print(f"SUCCESS: Sensor found on {port} at {baud} baud!")
            break
        print(f"Failed on {port} at {baud} baud")