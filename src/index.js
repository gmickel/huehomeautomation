'use strict';

const five = require('johnny-five');
const hugh = require('hugh');
const config = require('./config.js');
const moment = require('moment');
let potentiometer;
let photoresistor;
let cycleButton;
let modeButton;
let onOffButton;
let onOffButtonHold = false;
let manualButton;
let motion;
let lastLightValue = 1000;
let lastMotionDetected = moment().subtract(config.motionDuration, 'minutes');

let manualMode = false;

const state = hugh.lightState.create();
const hueAPI = new hugh.HueApi(config.host, config.username);

const colors = config.colors;
const modes = config.modes;
let cycleCursor = 0;
let modeCursor = 0;

const board = new five.Board();

board.on('ready', () => {
  onOffButton = new five.Button({
    board,
    pin: 5,
    invert: false
  });

  manualButton = new five.Button({
    board,
    pin: 6,
    invert: false
  });

  // Create a new `button` hardware instance
  cycleButton = new five.Button({
    board,
    pin: 8,
    invert: false
  });

  // Create a new `button` hardware instance
  modeButton = new five.Button({
    board,
    pin: 9,
    invert: false
  });

  // Create a new `potentiometer` hardware instance.
  potentiometer = new five.Sensor({
    pin: 'A0',
    freq: 250,
    threshold: 25
  });

  // Create a new `photoresistor` hardware instance.
  photoresistor = new five.Sensor({
    pin: 'A2',
    freq: 250,
    threshold: 25
  });

  motion = new five.Motion(7);

  // Inject the `button` hardware into
  // the Repl instance's context;
  // allows direct command line access
  board.repl.inject({
    cycleButton,
    modeButton,
    manualButton,
    onOffButton
  });

  // Button Event API

  // modeButton "down" pressed
  modeButton.on('down', () => {
    console.log('Mode button press down detected');
    modeCursor = (modeCursor !== modes.length - 1) ? modeCursor + 1 : 0;
    console.log('Mode switched to:', modes[modeCursor]);
  });

  // cycleButton "down" pressed
  cycleButton.on('down', () => {
    console.log('Cycle button press down detected');
    state.on()
      .hue(colors[cycleCursor].hue)
      .sat(colors[cycleCursor].sat)
      .bri(colors[cycleCursor].bri)
      .transitionTime(1);
    hueAPI.setGroupState(config.lightGroupId, state).then((response) => {
      console.log('Cycle colours for Hue group 1, status message:', response.data);
      cycleCursor = (cycleCursor !== colors.length - 1) ? cycleCursor + 1 : 0;
    });
  });

  // manualButton "down" pressed
  manualButton.on('down', () => {
    manualMode = !manualMode;
    console.log('Manual mode button press down detected, switching manual mode to', manualMode);
  });

  // "down" the button is pressed
  onOffButton.on('down', () => {
    onOffButtonHold = false;
  });

  // "hold" the button is pressed for specified time.
  //        defaults to 500ms (1/2 second)
  //        set
  onOffButton.on('hold', () => {
    console.log('On/off Button hold detected');
    onOffButtonHold = true;
    state.off();
    hueAPI.setGroupState(1, state).then((response) => {
      console.log('Turn Hue group 1 off, status message:', response.data);
    });
  });

  // "up" the button is released
  onOffButton.on('up', () => {
    if (!onOffButtonHold) {
      console.log('On/off Button press detected');
      state.on();
      hueAPI.setGroupState(1, state).then((response) => {
        console.log('Turn Hue group 1 on, status message:', response.data);
      });
    }
  });

  // Potentiometer Event API

  potentiometer.on('change', function onPotentiometerChange() {
    switch (modes[modeCursor]) {
      case 'Brightness':
        console.log(this.analog, this.raw);
        state.bri(this.analog).transitionTime(1);
        break;
      case 'Hue':
        console.log(this.analog, (this.raw + 1) * 64);
        state.hue((this.raw + 1) * 64).transitionTime(1);
        break;
      case 'Saturation':
        console.log(this.analog, this.raw);
        state.sat(this.analog).transitionTime(1);
        break;
      default:
        console.log(this.analog, this.raw);
        state.bri(this.analog).transitionTime(1);
    }
    hueAPI.setGroupState(config.lightGroupId, state).then((response) => {
      console.log(`Changing ${modes[modeCursor]} value, status message:`, response.data);
    });
  });

  // Motion Detector Event API

  motion.on('calibrated', () => {
    console.log('Motion calibrated');
  });

  // "motionstart" events are fired when the "calibrated"
  // proximal area is disrupted, generally by some form of movement
  motion.on('motionstart', () => {
    if (!manualMode) {
      console.log('Motion Detected');
      lastMotionDetected = moment();
      if (lastLightValue < config.lowerLightThreshold) {
        state.on();
        hueAPI.setGroupState(config.lightGroupId, state).then((response) => {
          console.log('Light over threshold value, turning lights on, status message:', response.data);
        });
      } else {
        console.log('Light under threshold value');
      }
    } else {
      console.log('Motion Detected but manual mode activated, skipping');
    }
  });

  // "motionend" events are fired following a "motionstart" event
  // when no movement has occurred in X ms
  motion.on('motionend', () => {
    console.log('motionend');
  });

  // Photoresistor Event API

  photoresistor.on('change', function onLightChange() {
    if (!manualMode) {
      console.log('Ambient light level change detected, ambient light value', this.value);
      let compareTime = moment().subtract(config.motionDuration, 'minutes');

      if (compareTime.isSameOrBefore(lastMotionDetected)
        && lastLightValue < config.lowerLightThreshold) {
        console.log('Last motion within time range and light levels under threshold');
        state.on();
        hueAPI.setGroupState(config.lightGroupId, state).then((response) => {
          console.log('Lights on, status message:', response.data);
        });
      }

      if (compareTime.isSameOrAfter(lastMotionDetected)
        && lastLightValue > config.upperLightThreshold) {
        console.log('Last motion outside of time range and light levels over threshold');
        state.off();
        hueAPI.setGroupState(config.lightGroupId, state).then((response) => {
          console.log('Lights off, status message:', response.data);
        });

        lastLightValue = this.value;
      }
    } else {
      console.log('Ambient light level change detected, but manual mode activated, skipping');
    }
  });
});