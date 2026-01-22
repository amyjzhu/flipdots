import { expect, test } from 'vitest'
import { Action, BottomLeftWildfire, bottomLeftWildfire, Colour, FlipdotHardware, genericGrowFromPoint, GroupAction, GrowFromPoint, wildfireTemplate } from './hardware';


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
    let grid = new BottomLeftWildfire().generateGrid(10, 10);
    // let grid = wildfireTemplate(10, 10);
    console.log(grid)
    let str = grid.map(r => r.join(" ")).join("\n");
    console.log(str);
    expect(str).toBe(`0 1 2 3 4 5 6 7 8 9
1 1 2 3 4 5 6 7 8 9
2 2 2 3 4 5 6 7 8 9
3 3 3 3 4 5 6 7 8 9
4 4 4 4 4 5 6 7 8 9
5 5 5 5 5 5 6 7 8 9
6 6 6 6 6 6 6 7 8 9
7 7 7 7 7 7 7 7 8 9
8 8 8 8 8 8 8 8 8 9
9 9 9 9 9 9 9 9 9 9`)
})

test("testing generic", () => {
    // I think it should just discard the ones that are already set 
    let circle = new GrowFromPoint([4,4], (x: number, y: number) => [[x+1,y+1],[x+1,y],[x,y+1],[x-1,y],[x-1,y+1],[x-1,y-1],[x,y-1],[x+1,y-1]]).generateGrid(10, 10);
    let str = visGrid(circle);
    console.log(str);
    expect(str).toBe(`3 3 3 3 3 3 3 3 3 4
3 2 2 2 2 2 2 2 3 4
3 2 1 1 1 1 1 2 3 4
3 2 1 0 0 0 1 2 3 4
3 2 1 0 0 0 1 2 3 4
3 2 1 0 0 0 1 2 3 4
3 2 1 1 1 1 1 2 3 4
3 2 2 2 2 2 2 2 3 4
3 3 3 3 3 3 3 3 3 4
4 4 4 4 4 4 4 4 4 4`)

let circleMultiStep = new GrowFromPoint([4,4], (x: number, y: number) => [[x+1,y+1],[x+1,y],[x,y+1],[x-1,y],[x-1,y+1],[x-1,y-1],[x,y-1],[x+1,y-1]], [1,2]).generateGrid(10, 10);
let str2 = visGrid(circleMultiStep);
    console.log(str2);
})