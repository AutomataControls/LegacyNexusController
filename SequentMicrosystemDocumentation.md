megabas-rpi
megabas
This is the python library to control the Building Automation Card for Raspberry Pi.

Install
sudo pip install SMmegabas
Usage
Now you can import the megaio library and use its functions. To test, read triacs status from the MegaIO IND board with stack level 0:

~$ python
Python 2.7.9 (default, Sep 17 2016, 20:26:04)
[GCC 4.9.2] on linux2
Type "help", "copyright", "credits" or "license" for more information.
>>> import megabas
>>> megabas.getTriacs(0)
0
>>>
Functions
def getVer(stack)
Return firmware version

stack - stack level of the megabas card (selectable from address jumpers [0..8])

setUOut(stack, ch, value)
Set the selected output 0-10V channel value in volts

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..4]

value - voltage output value in V [0..10]

getUOut(stack, ch)
Get the selected output 0-10V channel value in volts

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..4]

return - value in V [0..10]

getUIn(stack, ch)
Return the selected input 0-10V channel value in volts

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..8]

return - value in V [0..10]

getRIn1K(stack, ch)
Return the selected resistance (1K) measurements in kilo Ohms. This measurement is valid only if the jumper is place in "1K" position. On this type of input is recomended to measure 1kOhm thermistor.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..8]

return - value in kOhm [0..30] were 30 means invalid measurements

getRIn10K(stack, ch)
Return the selected resistance (10K) measurements in kilo Ohms. This measurement is valid only if the jumper is place in "10K" position. On this type of input is recomended to measure 10K thermistor.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..8]

return - value in kOhm [0..30]

setTriac(stack, ch, val)
Set one triac state.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - triac number (id) [1..4]

val - triac state 1: turn ON, 0: turn OFF[0..1]

setTriacs(stack, value)
Set all triacs state.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

value - 4 bit value of all triacs (ex: 15: turn on all triacs, 0: turn off all triacs, 1:turn on triac #1 and off the rest)

getTriac(stack, ch)
Return the state of one triac.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - triac number (id) [1..4]

return - (0/1)

getTriacs(stack)
Return the state of all triacs.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

return - [0..15]

togleTriac(stack, ch, delay, count)
Togle one triac state.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - triac number (id) [1..4]

delay - delay between togles

count - number of togles

getContact(stack)
Get the state of the dry contact inputs

stack - stack level of the megabas card (selectable from address jumpers [0..8])

return - value of the inputs [0..255]

getContactCh(stack, ch)
Get the state of the dry contact input channel

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..4]

return - value of the inputs [0/1]

getContactCounter(stack, ch)
Return the counter value for corresponding dry contact input.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..4]

return - counter value (32bits)

getContactCountEdge(stack, ch)
Return dry contact edge settings for coresponding channel

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..4]

return: 0 - edge count disable; 1 - rising edge count enabled; 2 - falling edge count enabled; 3 - both edges count enabled

setContactCountEdge(stack, ch, edge)
Set dry contact edge count mode

stack - stack level of the megabas card (selectable from address jumpers [0..8])

ch - selected channel number [1..4]

edge: 0 - edge count disable; 1 - rising edge count enabled; 2 - falling edge count enabled; 3 - both edges count enabled

getInVolt(stack)
Get the power supply voltage

stack - stack level of the megabas card (selectable from address jumpers [0..8])

return - the power supply in Volts

getRaspVolt(stack)
Get the raspberry power supply voltage (5V)

stack - stack level of the megabas card (selectable from address jumpers [0..8])

return - the Raspberry pi power supply in Volts

getCpuTemp(stack)
Get the cpu temperature

stack - stack level of the megabas card (selectable from address jumpers [0..8])

return - temperature in deg Celsius

wdtGetPeriod(stack)
Return the current period of the watchdog timer in seconds

stack - stack level of the megabas card (selectable from address jumpers [0..8])

wdtSetPeriod(stack, val)
Set the period of the watchdog in seconds, val = 65000 disable the watchdog

stack - stack level of the megabas card (selectable from address jumpers [0..8])

val - [10..65000]

wdtReload(stack)
Reload the watchdog timer with the current period. The next reload command must occur in no more the "period" time in order to prevent watchdog to re-power the Raspberry. This command also enables the watchdog if is disabled (power-up disabled).

stack - stack level of the megabas card (selectable from address jumpers [0..8])

wdtSetDefaultPeriod(stack, val)
This function updates the period that will be loaded after Raspberry power is turned off and back on. You must set this period long enough to let Raspberry boot-up and your "watchdog maintaining" script to start.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

value - [10...64999] seconds

wdtGetDefaultPeriod(stack)
Return the default period

stack - stack level of the megabas card (selectable from address jumpers [0..8])

value - [10...64999] seconds

wdtSetOffInterval(stack, val)
Set the time interval in seconds for keeping Raspberry power off in case of watchdog timer expire.

stack - stack level of the megabas card (selectable from address jumpers [0..8])

val - [10...4147200] seconds

wdtGetOffInterval(stack)
Return the Off time interval in seconds

stack - stack level of the megabas card (selectable from address jumpers [0..8])

return - [10...4147200] seconds

wdtGetResetCount(stack)
Return the numbers of Raspberry re-powers performed by the watchdog

stack - stack level of the megabas card (selectable from address jumpers [0..8])

return - [0..65535]

RTC Functions
rtcGet(stack)
Return the RTC date and time as a list

stack - stack level of the megabas card (selectable from address jumpers [0..7])

return (year, month, day, hour, minute, seconds)

rtcSet(stack, y, mo, d, h, m, s)
Set the RTC date and time

stack - stack level of the megabas card (selectable from address jumpers [0..7])

y - year between 2000..2255 or between 0..255

mo - month 1..12

d - day

h - hour

m - minutes

s - seconds

Owire Bus Functions
owbScan(stack)
Start scanning for connected sensors

stack - stack level of the megabas card (selectable from address jumpers [0..7])

owbGetSensorNo(stack)
Get the numbers of 18B20 sensors connected on the bus

stack - stack level of the megabas card (selectable from address jumpers [0..7])

return number of connected sensors

owbGetTemp(stack, sensor)
Read the temperature aquired by one sensor

stack - stack level of the megabas card (selectable from address jumpers [0..7])

sensor - sensor number [1..16]

return temperature in degree Celsius

owbGetRomCode(stack, sensor)
Read the unic ROM code of one sensor

stack - stack level of the megabas card (selectable from address jumpers [0..7])

sensor - sensor number [1..16]

return ROM code as 8 bytes array
-------------------------------------------------------------------------

Welcome to lib16univin’s documentation!
Install
sudo pip install SM16univin
or

sudo pip3 install SM16univin
Update
sudo pip install SM16univin -U
or

sudo pip3 install SM16univin -U
Initiate class
$ python
Python 3.9.2 (default, Feb 28 2021, 17:03:44)
[GCC 10.2.1 20210110] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> import lib16univin
>>> card = lib16univin.SM16univin()
>>> card.get_version()
>>>
Documentation
class lib16univin.SM16univin(stack=0, i2c=1)
Bases: object

Python class to control the 16 Universal Analog Inputs Card for Raspberry Pi.

Parameters:
stack (int) – Stack level/device number.
i2c (int) – i2c bus number
get_all_dig_in()
Get all digital (dry contact) input status as a bitmask.

Returns: (int) Optocoupled bitmask
get_all_leds()
Get all leds state as bitmask.

Returns: (int) Leds state bitmask
get_button()
Get button status.

Returns: (bool) status : True(ON)/False(OFF)
get_button_latch()
Get button latch status.

Returns: (bool) status : True(ON)/False(OFF)
get_dig_in(channel)
Get digital (dry contact) input status.

Parameters: channel (int) – Channel number
Returns: (bool) Channel status
get_dig_in_cnt_en(channel)
Get digital (dry contact) input counting edges status.

Parameters: channel (int) – Channel number
Returns: (int) Counting edge status : 0(disable)/1(enable)
get_dig_in_counter(channel)
Get digital (dry contact) inputs edges counter for one channel.

Parameters: channel (int) – Channel number
Returns: (int) dry contact transitions counter
get_led(led)
Get led state.

Parameters: led (int) – Led number
Returns: (int) Led state
get_r10k_in(channel)
Get 10k thermistor input channel value in ohms.

Parameters: channel (int) – Channel number
Returns: (int) Input value in ohms
get_r1k_in(channel)
Get 1k thermistor input channel value in ohms.

Parameters: channel (int) – Channel number
Returns: (int) Input value in ohms
get_rtc()
Get rtc time.

Returns: (tuple) date(year, month, day, hour, minute, second)
get_u_in(channel)
Get 0-10V input channel value in volts.

Parameters: channel (int) – Channel number
Returns: (float) Input value in volts
get_version()
Get firmware version.

Returns: (int) Firmware version number

reset_dig_in_counter(channel)
Reset optocoupled inputs edges counter.

Parameters: channel (int) – Channel number
set_all_leds(val)
Set all leds states as bitmask.

Parameters: val (int) – Leds bitmask
set_dig_in_cnt_en(channel, value)
Set digital (dry contact) input channel counting edges status.

Parameters:
channel (int) – Channel number
value (int) – Counting edge status 0(disable)/1(enable)
set_led(led, val)
Set led state.

Parameters:
led (int) – Led number
val – 0(OFF) or 1(ON)
set_rtc(year, month, day, hour, minute, second)
Set rtc time.

Parameters:
year (int) – current year
month (int) – current month
day (int) – current day
hour (int) – current hour
minute (int) – current minute
second (int) – current second
wdt_clear_reset_count()
Clear watchdog counter.

wdt_get_init_period()
Get watchdog initial period.

Returns: (int) Initial watchdog period in seconds
wdt_get_off_period()
Get watchdog off period in seconds.

Returns: (int) Watchfog off period in seconds.
wdt_get_period()
Get watchdog period in seconds.

Returns: (int) Watchdog period in seconds
wdt_get_reset_count()
Get watchdog reset count.

Returns: (int) Watchdog reset count
wdt_reload()
Reload watchdog.

wdt_set_init_period(period)
Set watchdog initial period.

Parameters: period (int) – Initial period in second
wdt_set_off_period(period)
Set off period in seconds

Parameters: period (int) – Off period in seconds
wdt_set_period(period)
Set watchdog period.

Parameters: period (int) – Channel number

  return ROM code as 8 bytes array

-------------------------------------------------
SM16relind
This is the python library to control the Sixteen Relays 8-Layer Stackable HAT for Raspberry Pi.

Install
sudo pip install SM16relind
or (if using python3.x):

sudo pip3 install SM16relind
Update
sudo pip install SM16relind -U
or (if using python3.x):

sudo pip3 install SM16relind -U
Manual installation (without pip)
~$ sudo apt-get update
~$ sudo apt-get install build-essential python-pip python-dev python-smbus git
~$ git clone https://github.com/SequentMicrosystems/16relind-rpi.git
~$ cd 16relind-rpi/python/
~/16relind-rpi/python$ sudo python setup.py install
If you use python3.x repace the last line with:

~/16relind-rpi/python$ sudo python3 setup.py install
Manual update (only if installed without pip)
~$ cd 16relind-rpi/
~/16relind-rpi$ git pull
~$ cd 16relind-rpi/python
~/16relind-rpi/python$ sudo python setup.py install
If you use python3.x repace the last line with:

~/16relind-rpi/python$ sudo python3 setup.py install
Usage example
~$ python
Python 3.10.7 (main, Nov  7 2022, 22:59:03) [GCC 8.3.0] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> import SM16relind
>>> rel = SM16relind.SM16relind(0)
>>> rel.set(1, 1)
>>> rel.get_all()
1
>>>
More usage example in the examples folder

Functions prototype
class SM16relind.SM16relind(stack = 0, i2c = 1)
Description
Init the SM16relind object and check the card presence
Parameters
stack : Card stack level [0..7] set by the jumpers
i2c : I2C port number, 1 - Raspberry default , 7 - rock pi 4, etc.
Returns
card object
set(relay, val)
Description
Set one relay state
Parameters
relay: The relay number 1 to 16
val: The new state of the relay 0 = turn off else turn on
Returns
none
set_all(val)
Description
Set the state of all relays as a 16 bits bit-map
Parameters
val: The new state of all 16 relays, 0 => all off, 15 => all on
Returns
none
get(relay)
Description
Read one relay state
Parameters
relay relay number [1..16]
Returns
the state of the relay 0 or 1
get_all()
Description
Read the state of all 16 relays
Parameters
none
Returns
relays state as bitmap [0..65535]
-----------------------------------------------------------

Welcome to SM16uout’s documentation!
Install
sudo pip install SM16uout
or

sudo pip3 install SM16uout
Update
sudo pip install SM16uout -U
or

sudo pip3 install SM16uout -U
Initiate class
$ python
Python 3.11.8 (main, Feb 12 2024, 14:50:05) [GCC 13.2.1 20230801] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> import SM16uout.SM16uout as m
>>> SM16uout = m()
>>>
Documentation

class SM16uout.SM16uout(stack=0, i2c=1)
Bases: object

Python class to control the Sixteen 0-10V Analog Outputs

Parameters:
stack (int) – Stack level/device number.
i2c (int) – i2c bus number
calib_status()
Get current calibration status of device.

Returns: (int) Calib status
get_version()
Get firmware version.

Returns: (int) Firmware version number

get_u_out(channel)
Get 0-10V output channel value in volts.

Parameters: channel (int) – Channel number
Returns: (float) 0-10V output value
set_u_out(channel, value)
Set 0-10V output channel value in volts.

Parameters:
channel (int) – Channel number
value (float) – Voltage value
cal_u_out(channel, value)
Calibrate 0-10V output channel. Calibration must be done in 2 points at min 5V apart.

Parameters:
channel (int) – Channel number
value (float) – Real(measured) voltage value
get_led(led)
Get led state.

Parameters: led (int) – Led number
Returns: 0(OFF) or 1(ON)
get_all_leds()
Get all leds state as bitmask.

Returns: (int) Leds state bitmask
set_led(led, val)
Set led state.

Parameters:
led (int) – Led number
val – 0(OFF) or 1(ON)
set_all_leds(val)
Set all leds states as bitmask.

Parameters: val (int) – Led bitmask
get_rs485()
NOT IMPLEMENTED

set_rs485(modbus, modbusId, baudrate=38400, stopbits=1, parity=0)
Set the RS485 port parameters

Parameters:
modbus (0/1) – 1: turn ON, 2: turn OFF
modbusId (1..254) – modbus ID
baudrate (1200..115200) – baud rate (default: 38400)
stopbits (1/2) – stop bits (default: 1)
parity (0/1/2) – stop bits (default: 0 - None)
disable_rs485()
Disable modbus and free the RS485 for Raspberry usage

wdt_reload()
Reload watchdog.

wdt_get_period()
Get watchdog period in seconds.

Returns: (int) Watchdog period in seconds
wdt_set_period(period)
Set watchdog period.

Parameters: period (int) – Channel number
wdt_get_init_period()
Get watchdog initial period.

Returns: (int) Initial watchdog period in seconds
wdt_set_init_period(period)
Set watchdog initial period.

Parameters: period (int) – Initial period in second
wdt_get_off_period()
Get watchdog off period in seconds.

Returns: (int) Watchfog off period in seconds.
wdt_set_off_period(period)
Set off period in seconds

Parameters: period (int) – Off period in seconds
wdt_get_reset_count()
Get watchdog reset count.

Returns: (int) Watchdog reset count
wdt_clear_reset_count()
Clear watchdog counter.

get_button()
Get button status.

Returns: (bool) status : True(ON)/False(OFF)
get_button_latch()
Get button latch status.

Returns: (bool) status : True(ON)/False(OFF)

----------------------------------------------------------------------------

8relind-rpi
lib8relind-RPI
This is the python library to control the 8-RELAYS Stackable Card for Raspberry Pi.

Install
sudo pip install SM8relind
Usage
Now you can import the lib8relind library and use its functions. To test, read relays status from the board with stack level 0:

~$ python
Python 2.7.9 (default, Sep 17 2016, 20:26:04)
[GCC 4.9.2] on linux2
Type "help", "copyright", "credits" or "license" for more information.
>>> import lib8relind
>>> lib8relind.get_all(0)
0
>>>
Functions
set(stack, relay, value)
Set one relay state.

stack - stack level of the 8-Relay card (selectable from address jumpers [0..7])

relay - relay number (id) [1..8]

value - relay state 1: turn ON, 0: turn OFF[0..1]

set_all(stack, value)
Set all relays state.

stack - stack level of the 8-Relay card (selectable from address jumpers [0..7])

value - 8 bit value of all relays (ex: 255: turn on all relays, 0: turn off all relays, 1:turn on relay #1 and off the rest)

get(stack, relay)
Get one relay state.

stack - stack level of the 8-Relay card (selectable from address jumpers [0..7])

relay - relay number (id) [1..8]

return 0 == relay off; 1 - relay on

get_all(stack)
Return the state of all relays.

stack - stack level of the 8-Relay card (selectable from address jumpers [0..7])

return - [0..255]