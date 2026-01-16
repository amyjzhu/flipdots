import { expect, test } from 'vitest'
import { Action, bottomLeftWildfire, Colour, FlipdotHardware, genericGrowFromPoint, GroupAction, wildfireTemplate } from './hardware';


// test('expect a failure', () => {


//     let f1 = new GroupAction(0, [[Action.FLIP, [0, 1, 2, 3]]]);
//     let f2 = new GroupAction(1, [[Action.FLIP, [0, 3,]]]);
//     let f3 = new GroupAction(0, [[Action.FLIP, [0, 1]]]);

//     let hw: FlipdotHardware = FlipdotHardware.Rectangular(5, 7, new Colour(), new Colour());
//     expect(() => hw.compile([f1, f2, f3])).toThrowError("could not compile") // should fail

// });


// test('expect working example', () => {


//     let f1 = new GroupAction(0, [[Action.FLIP, [0, 1, 2, 3]]]);
//     let f2 = new GroupAction(20, [[Action.FLIP, [0, 3,]]]);
//     let f3 = new GroupAction(40, [[Action.FLIP, [0, 1]]]);

//     let hw: FlipdotHardware = FlipdotHardware.Rectangular(5, 7, new Colour(), new Colour());
    
//     hw.compileToFile([f1, f2, f3], "test-working.txt");
// });

let visGrid = (grid: number[][]) => grid.map(r => r.join(" ")).join("\n");
test("testing grid", () => {
    let grid = bottomLeftWildfire(10, 10);
    // let grid = wildfireTemplate(10, 10);
    console.log(grid)
    console.log(grid.map(r => r.join(" ")).join("\n"))
})

test("testing generic", () => {
    // I think it should just discard the ones that are already set 
    let circle = genericGrowFromPoint([4,4], (x: number, y: number) => [[x+1,y+1],[x+1,y],[x,y+1],[x-1,y],[x-1,y+1],[x-1,y-1],[x,y-1],[x+1,y-1]])(10, 10);
    console.log(visGrid(circle))
})