interface HardwareInterface {
    units: Unit[][] // need to map these somewhere somehow
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId, time: Time) => [UnitId[], Time];
    actionToHardwareAction: (action: Action, id: UnitId, time: Time) => void;
}

type Time = number | [number, Action];
type UnitId = number;
type StateId = number; 

class Unit {
    actions: Action[] = [];
    states: [Action, [StateId, State][]][] = [];
}

enum Action {
    FLIP,
    SET,
    FLUTTER
}

class Colour {
    rgb: [number, number, number] = [0,0,0];
}

class State {
    image: Colour[][] = [];
}

class GroupAction {
    tPlus: Time = 0;
    actions: [Action, UnitId[]][] = [];
}

interface Transition {
    // just curry these later 
    generateGroupAction: (o1: Object, o2: Object, h: HardwareInterface) => GroupAction;
}



///////////////


class FlipdotHardware implements HardwareInterface {
    units: Unit[][];
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId, time: Time) => [UnitId[], Time];
    actionToHardwareAction: (action: Action, id: UnitId, time: Time) => void;

}