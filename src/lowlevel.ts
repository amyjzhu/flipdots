/// what is happening here 
// need to make a low-level language 
// 

// basics are:
// capture the hardware capabilities
// translate those 


// we have hardware:
// has a list of units in the display
// we can control units directly to perform an action (the units themselves have an API)
// how do we capture the CONCEPTS OF MOTION that are gestalt - this is something that transition language should target 

// for example: if my previous unit is already moving, I might start moving partway through its motion to create more velocity
// what control, what granularity control do I have over the components? 
// the display unit itself has an API that says whether operations are permitted or something
// maybe... okay... what if you ask for something to be done, and it returns you the closest possible thing? 
// and then you compare and see how close it is? 

// but how is that going to help WRITE transitions? 

// 1) we have a list of ABSTRACT actions
// abstract actions are MORE higher-level than per-unit instructions
// and GUIDE the user into designing meaningfully different transitions
// abstract actions are compiled differently to different hardware
// choreography???


// example transitions:
// move this thing
// wave unveil this thing
// flutter this thing
// suggest this shape by making static

// and then actions would be like
// over a larger AREA of pixels, I want to do these things in this amount of time
// maybe: over a larger area of pixels, do this and "this" is something.
// is an action a function? I guess that doesn't really make sense...
// actions are lower-level than transitions, because transitions think about objects and update them
// the ACTION input is, I give you a set of dots, you do something with them.
// you can supply a time function that says how the dots flip?

// give a SET of actions to a SET of pixels: like flutter, etc
// but the display device has to determine if it's possible...
// the rpoblem is really this "over time" thing...
// what am I controlling and how much time is it, how granular is it...


// actions are like:
// 0 seconds: flip 1 flutter 2 flip 3 
// 30 second: flip 1 flutter 2 flip 3
// 40 second: flutter 1 flutter 2 flutter 3
// or something?
// and then... whether that is actually allowed... is not super clear
// actions are flip, flutter? no, those are like, unit api things.

// flutter, flip etc.
// whether or not they can actually be done on that TIME SCHEDULE is action
// but maybe we could use words like "cascade" and give a time vector field...???? 
// maybe transitions can go through multiple stages of lowering