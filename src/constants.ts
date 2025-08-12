import * as THREE from 'three';
import { BAD_APPLE_STRING_10FPS_64x48 } from './badapple64x48';
import { BAD_APPLE_STRING_10FPS_32x24 } from './programs';

export let SOUND_ENABLED = false;
// slightly worse imo but much faster for big, at least works for 32x24 (not 64x48 yet). normal sound enabled is only viable for 5x7
export let PERFORMANT_SOUND_ENABLED = false;
export let USE_X_DISC = false;

export let PERFORMANT_NUM_X_SPEAKERS = 4;
export let PERFORMANT_NUM_Y_SPEAKERS = 4;

let BALL_ANIM = [...Array(9)].map((_,i) => `/ball${i + 1}.png`)

let GOLFHEIGHT = 50;
let GOLFWIDTH = 100;

let GOLF_ANIM = [...Array(9)].map((_,i) => `/animations/golf${i + 1}.png`)
let TEXT_WAVE = [...Array(5)].map((_,i) => `/animations/text${i + 1}.png`)
let TEXT_FALL_WAVE = [...Array(15)].map((_,i) => `/animations/textfall${i + 1}.png`)
let TEXT_SWIPE = [...Array(7)].map((_,i) => `/animations/textswipe${i + 1}.png`)
let TEXT_LINE = [...Array(6)].map((_,i) => `/animations/textline${i + 1}.png`)


// export let WIDTH = 64;
// export let HEIGHT = 48;
// export let BAD_APPLE = BAD_APPLE_STRING_10FPS_64x48;

// export let WIDTH = 32;
// export let HEIGHT = 24;
// export let BAD_APPLE = BAD_APPLE_STRING_10FPS_32x24;

// export let WIDTH = 5;
// export let HEIGHT = 7;

export let WIDTH = GOLFWIDTH;
export let HEIGHT = GOLFHEIGHT;

// these anims are 32x24
let ALL_ANIMS = {
  "sparklenormal": [...Array(9)].map((_,i) => `/animations/sparklenormal${i + 1}.png`),
  "sparkle": [...Array(9)].map((_,i) => `/animations/sparkle${i + 1}.png`),
  "sparklebg": [...Array(9)].map((_,i) => `/animations/sparklebg${i + 1}.png`),
  "sparkletrail": [...Array(11)].map((_,i) => `/animations/sparkletrail${i + 1}.png`),
  "sparkletrailbg": [...Array(11)].map((_,i) => `/animations/sparkletrailbg${i + 1}.png`),
  "slide-normal": [...Array(14)].map((_,i) => `/animations/slide-normal${i + 1}.png`),
  "slide-accelerate": [...Array(14)].map((_,i) => `/animations/slide-accelerate${i + 1}.png`),
  "slide-stretch": [...Array(14)].map((_,i) => `/animations/slide-stretch${i + 1}.png`),
  // "slide-stretch-lag": [...Array(28)].map((_,i) => `/animations/slide-stretch-lag${i + 1}.png`),
  "slide-stretch-accelerate": [...Array(14)].map((_,i) => `/animations/slide-stretch-accelerate${i + 1}.png`),
  // "slide-anticipate-block": [...Array(14)].map((_,i) => `/animations/slide-anticipate-block${i + 1}.png`),
  // "slide-anticipate": [...Array(14)].map((_,i) => `/animations/slide-anticipate${i + 1}.png`),
  "slide-impact": [...Array(14)].map((_,i) => `/animations/slide-impact${i + 1}.png`),
  // "impact-consistent": [...Array(14)].map((_,i) => `/animations/impact-consistent${i + 1}.png`),
  "grow-standard": [...Array(14)].map((_,i) => `/animations/grow-standard${i + 1}.png`),
  "grow-anticipate": [...Array(14)].map((_,i) => `/animations/grow-anticipate${i + 1}.png`),
}

export let ALL_ANIMATIONS = Object.values(ALL_ANIMS).flat()

export let ANIMATION_PATHS = TEXT_LINE;

export let REVERSE_ANIM = false;
export let CONTROL_ANIM = false;

let slowishFrames = [12, 24];
let fastFrames = [4,12]; // fast frames is the best default for now imo
let fastestFrames = [2, 12];
export let NUM_FRAMES_ROTATING = fastFrames[0];
export let FULL_CYCLE_LENGTH = fastFrames[1];

export let SPLIT_FLAP_CYCLE_LENGTH = 60;

export let RENDERER_SIZE_SCALEDOWN = 2;
// originally 60 
export let CAMERA_DISTANCE = 400;

let pink = "#ee3030";
// let pink = 0xffeaf3;
let green = 0x02f516;
// export let DISC_FRONT_COLOUR = pink;
// export let DISC_BACK_COLOUR = green;
export let DISC_SIDE_COLOUR = 0x000000;


export let DISC_FRONT_COLOUR = (i: number) => new THREE.Color(0x0000ff).toArray();
export let DISC_BACK_COLOUR = (i: number) => new THREE.Color(0xffff00).toArray();
// export let DISC_BACK_COLOUR = (i: number) => i % 2 == Math.floor(i / WIDTH) % 2 ? new THREE.Color(green).toArray() : new THREE.Color("#1754fd").toArray();
// export let DISC_BACK_COLOUR = (i: number) => i % 2 == 0 ? new THREE.Color(green).toArray() : new THREE.Color("#1754fd").toArray();


export let INV_Y_ON_LOAD = true;
