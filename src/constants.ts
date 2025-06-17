import * as THREE from 'three';
import { BAD_APPLE_STRING_10FPS_64x48 } from './badapple64x48';
import { BAD_APPLE_STRING_10FPS_32x24 } from './programs';

// export let WIDTH = 64;
// export let HEIGHT = 48;
// export let BAD_APPLE = BAD_APPLE_STRING_10FPS_64x48;

export let WIDTH = 32;
export let HEIGHT = 24;
export let BAD_APPLE = BAD_APPLE_STRING_10FPS_32x24;

// export let WIDTH = 5;
// export let HEIGHT = 7;

export let SOUND_ENABLED = false;
// slightly worse imo but much faster for big, at least works for 32x24 (not 64x48 yet). normal sound enabled is only viable for 5x7
export let PERFORMANT_SOUND_ENABLED = true;
export let USE_X_DISC = false;

export let PERFORMANT_NUM_X_SPEAKERS = 4;
export let PERFORMANT_NUM_Y_SPEAKERS = 4;

export let ANIMATION_PATHS = ["/ball1.png", 
    "/ball2.png", 
    "/ball3.png",
    "/ball4.png",
    "/ball5.png",
    "/ball6.png",
    "/ball7.png",
    "/ball8.png",
    "/ball9.png",
  ];

let slowishFrames = [12, 24];
let fastFrames = [4,12]; // fast frames is the best default for now imo
let fastestFrames = [2, 12];
export let NUM_FRAMES_ROTATING = fastFrames[0];
export let FULL_CYCLE_LENGTH = fastFrames[1];

// originally 60 
export let CAMERA_DISTANCE = 400;

let pink = "#ee3030";
// let pink = 0xffeaf3;
let green = 0x02f516;
// export let DISC_FRONT_COLOUR = pink;
// export let DISC_BACK_COLOUR = green;
export let DISC_SIDE_COLOUR = 0x000000;


export let DISC_FRONT_COLOUR = (i: number) => new THREE.Color(pink).toArray();
// export let DISC_BACK_COLOUR = (i: number) => new THREE.Color(green).toArray();
export let DISC_BACK_COLOUR = (i: number) => i % 2 == Math.floor(i / WIDTH) % 2 ? new THREE.Color(green).toArray() : new THREE.Color("#1754fd").toArray();
// export let DISC_BACK_COLOUR = (i: number) => i % 2 == 0 ? new THREE.Color(green).toArray() : new THREE.Color("#1754fd").toArray();


export let INV_Y_ON_LOAD = true;
