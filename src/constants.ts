
export let WIDTH = 32;
export let HEIGHT = 24;

// export let WIDTH = 5;
// export let HEIGHT = 7;

export let SOUND_ENABLED = false;
export let USE_X_DISC = false;

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

let pink = 0xffeaf3;
let green = 0x02f516;
export let DISC_FRONT_COLOUR = pink;
export let DISC_BACK_COLOUR = green;
export let DISC_SIDE_COLOUR = 0x000000;




export let INV_Y_ON_LOAD = true;
