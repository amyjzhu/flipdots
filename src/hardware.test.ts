import { expect, test } from 'vitest'
import { Action, Colour, FlipdotHardware, GroupAction } from './hardware';


test('expect a failure', () => {


    let f1 = new GroupAction(0, [[Action.FLIP, [0, 1, 2, 3]]]);
    let f2 = new GroupAction(1, [[Action.FLIP, [0, 3,]]]);
    let f3 = new GroupAction(0, [[Action.FLIP, [0, 1]]]);

    let hw: FlipdotHardware = FlipdotHardware.Rectangular(5, 7, new Colour(), new Colour());
    expect(() => hw.compile([f1, f2, f3])).toThrowError("could not compile") // should fail

});


test('expect a failure', () => {


    let f1 = new GroupAction(0, [[Action.FLIP, [0, 1, 2, 3]]]);
    let f2 = new GroupAction(20, [[Action.FLIP, [0, 3,]]]);
    let f3 = new GroupAction(40, [[Action.FLIP, [0, 1]]]);

    let hw: FlipdotHardware = FlipdotHardware.Rectangular(5, 7, new Colour(), new Colour());
    hw.compile([f1, f2, f3]) // should fail

});