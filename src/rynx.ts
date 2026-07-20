// Create a Rynx simulation.
// It should be structurally similar to the SplitFlap display
// The idea is that this display is made up of a series of wheels.
// Each wheel is spinning under a viewing window, and the window that only shows five pixels of the wheel at once
// The wheel is oriented vertically, so it reads as 1 column by 5 rows
// Each wheel spins until it reaches the correct configuration of pixels under the viewing window.
// For example, to show the number 9 with three reels, we would have (with 0 being black and 1 being white)
// 1 1 1
// 1 0 1
// 1 1 1
// 0 0 1
// 0 0 1


// Basic setup:
// For each unit, create a cylinder, turned 90 degrees so its curved side faces outwards.
// The cylinder should be black around, except for the edge.
// The edge should be divided into 32 roughly square-shaped segments.
// These units should fit inside a bigger "casing" cylinder, as though coins in a coin sleeve.
// The casing cylinder should have a cutout along its side big enough to show the five facing-forward
// squares on each unit
// When animating, rotate each unit so that the bottom square moves up, the top square moves out
// of the window, and the square below the bottom square is now visible.
// Let's start with having the squares coloured in according to an input string,
// and having each unit move one step at a time.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Recorder } from './recorder';

export const SEGMENTS_PER_WHEEL = 32;
export const WINDOW_ROWS = 5;
const SEG_ANGLE = (2 * Math.PI) / SEGMENTS_PER_WHEEL;

// ── Wheel pattern ─────────────────────────────────────────────────────────────
// 32 segments viewed through a 5-pixel window is exactly the de Bruijn setup:
// B(2,5) has length 2^5 = 32 and contains every 5-bit string exactly once as a
// cyclic window. So a single fixed paint job on the wheel can display ANY
// column of 5 pixels — we just have to rotate to the right offset.

export function deBruijn(k: number, n: number): number[] {
    const a = new Array(k * n).fill(0);
    const seq: number[] = [];
    function db(t: number, p: number) {
        if (t > n) {
            if (n % p === 0) for (let i = 1; i <= p; i++) seq.push(a[i]);
        } else {
            a[t] = a[t - p];
            db(t + 1, p);
            for (let j = a[t - p] + 1; j < k; j++) {
                a[t] = j;
                db(t + 1, t);
            }
        }
    }
    db(1, 1);
    return seq;
}

// ── Pixel font ────────────────────────────────────────────────────────────────
// 5 rows tall, top row first; variable width — digits are 3 columns wide,
// letters 4, punctuation narrower. (The 9 matches the example in the header
// comment.)

const FONT: Record<string, string[]> = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '001', '001', '001'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '001'],
    'A': ['0110', '1001', '1111', '1001', '1001'],
    'B': ['1110', '1001', '1110', '1001', '1110'],
    'C': ['0111', '1000', '1000', '1000', '0111'],
    'D': ['1110', '1001', '1001', '1001', '1110'],
    'E': ['1111', '1000', '1110', '1000', '1111'],
    'F': ['1111', '1000', '1110', '1000', '1000'],
    'G': ['0111', '1000', '1011', '1001', '0111'],
    'H': ['1001', '1001', '1111', '1001', '1001'],
    'I': ['1110', '0100', '0100', '0100', '1110'],
    'J': ['0011', '0001', '0001', '1001', '0110'],
    'K': ['1001', '1010', '1100', '1010', '1001'],
    'L': ['1000', '1000', '1000', '1000', '1111'],
    'M': ['1001', '1111', '1111', '1001', '1001'],
    'N': ['1001', '1101', '1011', '1001', '1001'],
    'O': ['1111', '1001', '1001', '1001', '1111'],
    'P': ['1110', '1001', '1110', '1000', '1000'],
    'Q': ['0110', '1001', '1001', '1010', '0101'],
    'R': ['1110', '1001', '1110', '1010', '1001'],
    'S': ['0111', '1000', '0110', '0001', '1110'],
    'T': ['1111', '0100', '0100', '0100', '0100'],
    'U': ['1001', '1001', '1001', '1001', '1111'],
    'V': ['1001', '1001', '1001', '1001', '0110'],
    'W': ['1001', '1001', '1111', '1111', '1001'],
    'X': ['1001', '1001', '0110', '1001', '1001'],
    'Y': ['1001', '1001', '0110', '0010', '0010'],
    'Z': ['1111', '0001', '0110', '1000', '1111'],
    '!': ['1', '1', '1', '0', '1'],
    '?': ['111', '001', '011', '000', '010'],
    '-': ['000', '000', '111', '000', '000'],
    ':': ['0', '1', '0', '1', '0'],
    '.': ['0', '0', '0', '0', '1'],
    ' ': ['00', '00', '00', '00', '00'],
};

// A column is 5 bits, index 0 = top row.
export type Column = number[];

const BLANK_COLUMN: Column = [0, 0, 0, 0, 0];

// Turn a string into a list of pixel columns: one column per glyph column
// (glyphs vary in width), 1 blank spacing column between glyphs.
export function textToColumns(text: string): Column[] {
    const columns: Column[] = [];
    for (const rawCh of text.toUpperCase()) {
        const glyph = FONT[rawCh] ?? FONT[' '];
        if (columns.length > 0) columns.push([...BLANK_COLUMN]);
        for (let c = 0; c < glyph[0].length; c++) {
            columns.push(glyph.map(row => (row[c] === '1' ? 1 : 0)));
        }
    }
    return columns;
}

// ── The display ───────────────────────────────────────────────────────────────

const WHEEL_RADIUS = 40;
// chord of one 11.25° segment — the wheel is this thick so segments read as squares
const SEGMENT_SIZE = 2 * WHEEL_RADIUS * Math.sin(SEG_ANGLE / 2);
const WHEEL_GAP = 0.8;
const CASING_RADIUS = WHEEL_RADIUS + 4;

// A step schedule, mirroring splitflap's setNextFlips: maps the number of
// steps a wheel has completed so far to the number of frames it should hold
// before taking its next one-segment step; undefined = stop stepping.
export type StepSchedule = (stepsSoFar: number) => (wheel: number) => number | undefined;

export interface RynxOptions {
    numWheels: number;
    // where to mount the canvas; defaults to #render, then document.body
    container?: HTMLElement;
    // 32 black/white entries painted around every wheel; defaults to de Bruijn B(2,5)
    wheelPattern?: number[];
    // frames it takes to advance one segment
    framesPerStep?: number;
    // extra frames a wheel rests between steps (0 = continuous)
    pauseFrames?: number;
}

export class RynxDisplay {
    numWheels: number;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;

    // the black/white paint job around each wheel's edge; shared by all wheels
    wheelPattern: number[];

    wheels: THREE.Group[] = [];
    // index (0..31) of the wheel segment currently at the TOP of the window
    positions: number[] = [];

    // ── step schedule (mirrors splitflap's setNextFlips/perPixelPauses) ──
    // After wheel i completes its s-th step, animate() asks
    // setNextSteps(s)(i) how many frames to hold before the NEXT step;
    // undefined means the wheel is done and stays put.
    setNextSteps: StepSchedule = () => () => undefined;
    // frames each wheel still holds before its next step (undefined = idle)
    perWheelPauses: (number | undefined)[] = [];
    // steps completed per wheel since the last resetAnimation
    totalSteps: number[] = [];
    // frames elapsed within the current hold+step cycle
    stepCounters: number[] = [];

    // frames it takes to advance one segment
    framesPerStep = 6;
    // extra frames a wheel rests between steps (0 = continuous)
    pauseFrames = 2;

    // same capture hook as SplitFlapDisplay: assign a Recorder, call start(),
    // and animate() ticks it after every render
    recorder: Recorder | undefined;

    constructor(options: RynxOptions) {
        const { numWheels, container } = options;
        this.numWheels = numWheels;
        this.wheelPattern = options.wheelPattern ?? deBruijn(2, WINDOW_ROWS);
        this.framesPerStep = options.framesPerStep ?? this.framesPerStep;
        this.pauseFrames = options.pauseFrames ?? this.pauseFrames;
        if (this.wheelPattern.length !== SEGMENTS_PER_WHEEL) {
            throw new Error(`wheel pattern must have ${SEGMENTS_PER_WHEEL} entries`);
        }

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1e);

        const targetEl = container ?? document.getElementById('render') ?? document.body;
        const targetW = container ? (container.clientWidth || 640) : window.innerWidth;
        const targetH = container ? (container.clientHeight || 400) : window.innerHeight;

        this.camera = new THREE.PerspectiveCamera(75, targetW / targetH, 0.1, 2000);
        this.camera.position.z = 300;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        this.renderer.setSize(targetW, targetH);
        this.renderer.setAnimationLoop(this.animate);
        targetEl.appendChild(this.renderer.domElement);

        new OrbitControls(this.camera, this.renderer.domElement);

        this.initLights();
        this.makeWheels();
        this.makeCasing();
        this.fitCamera();
    }

    initLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));

        const key = new THREE.DirectionalLight(0xffffff, 1.6);
        key.position.set(0, 120, 220);
        this.scene.add(key);

        const top = new THREE.DirectionalLight(0xffffff, 0.7);
        top.position.set(-80, 200, 60);
        this.scene.add(top);
    }

    // x-coordinate of wheel i's centre; wheels are lined up along the x axis
    wheelX(i: number): number {
        const pitch = SEGMENT_SIZE + WHEEL_GAP;
        return (i - (this.numWheels - 1) / 2) * pitch;
    }

    // Paint the wheel pattern as 32 square stripes around the cylinder's side.
    //
    // Mapping (worked out from three.js conventions — see applyRotation for the
    // matching rotation): CylinderGeometry's side runs u: 0→1 as the cylinder
    // angle θ goes 0→2π (θ=0 at local +z), and after the mesh is stood up with
    // rotation.z = π/2 the cylinder angle θ equals the window-plane angle
    // measured from front (+z) towards up (+y). A positive rotation about x
    // moves the front face DOWN, so for content to scroll UP as `pos` advances
    // the wheel must rotate by -pos steps — which works out to stripe s of the
    // texture holding pattern index (32 - s) % 32.
    makeWheelTexture(): THREE.CanvasTexture {
        const STRIPE = 64;
        const canvas = document.createElement('canvas');
        canvas.width = STRIPE * SEGMENTS_PER_WHEEL;
        canvas.height = STRIPE;
        const ctx = canvas.getContext('2d')!;

        for (let s = 0; s < SEGMENTS_PER_WHEEL; s++) {
            const j = (SEGMENTS_PER_WHEEL - s) % SEGMENTS_PER_WHEEL;
            ctx.fillStyle = this.wheelPattern[j] ? '#f2f0e8' : '#0d0d0d';
            ctx.fillRect(s * STRIPE, 0, STRIPE, STRIPE);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        return texture;
    }

    makeWheels() {
        const texture = this.makeWheelTexture();
        const sideMaterial = new THREE.MeshPhongMaterial({ map: texture });
        const capMaterial = new THREE.MeshPhongMaterial({ color: 0x050505 });
        const geometry = new THREE.CylinderGeometry(
            WHEEL_RADIUS, WHEEL_RADIUS, SEGMENT_SIZE, 96);

        for (let i = 0; i < this.numWheels; i++) {
            const wheel = new THREE.Group();

            const body = new THREE.Mesh(geometry, [sideMaterial, capMaterial, capMaterial]);
            body.rotation.z = Math.PI / 2; // cylinder axis along x — curved side faces outward
            wheel.add(body);

            wheel.position.x = this.wheelX(i);
            this.scene.add(wheel);
            this.wheels.push(wheel);
            this.positions.push(0);
            this.perWheelPauses.push(undefined);
            this.totalSteps.push(0);
            this.stepCounters.push(0);
            this.applyRotation(i, 0);
        }
    }

    makeCasing() {
        // One tube around all the wheels, like a coin sleeve, with a slot cut out
        // of the front for the 5 window rows. The slot is a bit SMALLER than the
        // 5 rows (edges at ±2.2 segments instead of ±2.5): the casing sits 4
        // units above the wheel surface, so a sightline grazing a ±2.5 edge from
        // the default camera lands ~2.8 segments up the wheel — showing a
        // distracting sliver of the 6th square. Pulling the edges in to ±2.2
        // moves the grazing point to ~2.44, hiding everything past the window at
        // the cost of clipping the outer edge of the top and bottom rows.
        const length = this.numWheels * (SEGMENT_SIZE + WHEEL_GAP) + WHEEL_GAP * 2;
        const windowArc = (WINDOW_ROWS - 0.6) * SEG_ANGLE;
        const casingGeometry = new THREE.CylinderGeometry(
            CASING_RADIUS, CASING_RADIUS, length, 64, 1, true,
            windowArc / 2, 2 * Math.PI - windowArc);
        // Outside is lit; the INSIDE (visible peeking between the wheels) is a
        // separate unlit pure-black pass, so the tube's interior can't catch the
        // front light and reflect grey through the gaps.
        // brass: warm base with a strong warm specular highlight
        const outerMaterial = new THREE.MeshPhongMaterial({
            color: 0x6b5226,
            specular: 0xffe6b0,
            shininess: 60,
            side: THREE.FrontSide,
        });
        const innerMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            side: THREE.BackSide,
        });
        const casing = new THREE.Mesh(casingGeometry, outerMaterial);
        const casingInner = new THREE.Mesh(casingGeometry, innerMaterial);
        // lay the tube along the x axis; after this rotation the cutout (which
        // started centred on +z) still faces the camera
        casing.rotation.z = Math.PI / 2;
        casingInner.rotation.z = Math.PI / 2;
        this.scene.add(casing);
        this.scene.add(casingInner);
    }

    fitCamera() {
        const width = this.numWheels * (SEGMENT_SIZE + WHEEL_GAP) + 40;
        const height = CASING_RADIUS * 2 + 40;
        const dist = this.camera.position.z;
        const aspect = this.camera.aspect;
        if (aspect < width / height) {
            this.camera.fov = 2 * Math.atan((width / aspect) / (2 * dist)) * (180 / Math.PI);
        } else {
            this.camera.fov = 2 * Math.atan(height / (2 * dist)) * (180 / Math.PI);
        }
        this.camera.updateProjectionMatrix();
    }

    // Rotating to -(pos + 1.5) segments puts pattern[pos] at the top window row
    // and pattern[pos + r] at row r. The 1.5: stripe centres sit at half-segment
    // offsets (+0.5), and the top row is 2 segments above centre — 2 - 0.5 = 1.5.
    // The sign is negative because a positive x-rotation moves the front face
    // down; stepping pos forward must move it UP (bottom pixel rises, top pixel
    // exits, a new one appears at the bottom).
    // stepProgress (0..1) is the smooth part-way rotation of the current step.
    applyRotation(i: number, stepProgress: number) {
        this.wheels[i].rotation.x = -(this.positions[i] + 1.5 + stepProgress) * SEG_ANGLE;
    }

    // the 5 bits currently (logically) under wheel i's window, top row first
    visibleColumn(i: number): Column {
        return Array.from({ length: WINDOW_ROWS },
            (_, r) => this.wheelPattern[(this.positions[i] + r) % SEGMENTS_PER_WHEEL]);
    }

    // find the rotation at which the window shows `column`; with the de Bruijn
    // pattern every column exists exactly once, but for custom patterns fall
    // back to the closest match
    findPositionFor(column: Column): number {
        let best = 0;
        let bestScore = -1;
        for (let pos = 0; pos < SEGMENTS_PER_WHEEL; pos++) {
            let score = 0;
            for (let r = 0; r < WINDOW_ROWS; r++) {
                if (this.wheelPattern[(pos + r) % SEGMENTS_PER_WHEEL] === column[r]) score++;
            }
            if (score === WINDOW_ROWS) return pos;
            if (score > bestScore) { bestScore = score; best = pos; }
        }
        console.warn('column not on wheel, using closest match', column);
        return best;
    }

    // If a wheel is mid-motion, land it on the position it was stepping to, so
    // a new schedule starts from whole positions. (Snaps at most one segment;
    // a no-op when the display is settled.)
    private commitInFlightSteps() {
        for (let i = 0; i < this.numWheels; i++) {
            const pause = this.perWheelPauses[i];
            if (pause !== undefined && this.stepCounters[i] > pause) {
                this.positions[i] = (this.positions[i] + 1) % SEGMENTS_PER_WHEEL;
            }
            this.stepCounters[i] = 0;
            this.applyRotation(i, 0);
        }
    }

    // Install a new step schedule, like splitflap's resetAnimation: step
    // counters restart at 0 and each wheel's first hold comes from newSteps(0).
    resetAnimation = (newSteps: StepSchedule) => {
        this.commitInFlightSteps();
        this.setNextSteps = newSteps;
        this.totalSteps = this.wheels.map(() => 0);
        this.perWheelPauses = this.wheels.map((_, i) => newSteps(0)(i));
    }

    // Spin each wheel to a target column (the default "just show it" schedule:
    // every wheel steps continuously until it arrives). Extra columns are
    // dropped; missing ones blank.
    setColumns(columns: Column[]) {
        this.commitInFlightSteps();
        const stepsNeeded = Array.from({ length: this.numWheels }, (_, i) => {
            const target = this.findPositionFor(columns[i] ?? BLANK_COLUMN);
            return (target - this.positions[i] + SEGMENTS_PER_WHEEL) % SEGMENTS_PER_WHEEL;
        });
        this.resetAnimation(s => i => (s < stepsNeeded[i] ? this.pauseFrames : undefined));
    }

    // Render a string with the 4x5 font, centred across the wheels.
    showText(text: string) {
        const columns = textToColumns(text);
        const pad = Math.max(0, Math.floor((this.numWheels - columns.length) / 2));
        const padded: Column[] = [
            ...Array.from({ length: pad }, () => [...BLANK_COLUMN]),
            ...columns,
        ];
        this.setColumns(padded);
    }

    scramble() {
        const steps = Array.from({ length: this.numWheels },
            () => Math.floor(Math.random() * SEGMENTS_PER_WHEEL));
        this.resetAnimation(s => i => (s < steps[i] ? this.pauseFrames : undefined));
    }

    isSettled(): boolean {
        return this.perWheelPauses.every(p => p === undefined);
    }

    animate = () => {
        for (let i = 0; i < this.numWheels; i++) {
            const pause = this.perWheelPauses[i];
            if (pause === undefined) continue;

            const counter = this.stepCounters[i];
            if (counter < pause) {
                // Phase A: hold
                this.stepCounters[i]++;
            } else {
                // Phase B: move one segment over framesPerStep frames
                const progress = counter - pause + 1;
                this.applyRotation(i, progress / this.framesPerStep);

                if (progress >= this.framesPerStep) {
                    // step complete: commit the new position (wheels only spin
                    // forward) and ask the schedule for the next hold
                    this.positions[i] = (this.positions[i] + 1) % SEGMENTS_PER_WHEEL;
                    this.applyRotation(i, 0);
                    this.totalSteps[i] += 1;
                    this.perWheelPauses[i] = this.setNextSteps(this.totalSteps[i])(i);
                    this.stepCounters[i] = 0;
                } else {
                    this.stepCounters[i]++;
                }
            }
        }

        this.renderer.render(this.scene, this.camera);
        this.recorder?.tick();
    }
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function formatHHMM(t: Date): string {
    return `${String(t.getHours()).padStart(2, '0')}:` +
        `${String(t.getMinutes()).padStart(2, '0')}`;
}

// Run a display as an HH:MM clock at `speed`× realtime — only the wheels whose
// digits change spin when the (simulated) minute ticks over. If `message` is
// given, the display shows it instead of the time while the simulated second
// hand is inside `messageWindow`, then rolls back to the time. Returns the
// interval id so callers can stop it.
export function runClock(
    display: RynxDisplay, speed = 1,
    message?: string, messageWindow: [number, number] = [20, 40],
): number {
    const start = Date.now();
    let shown = '';
    const tick = () => {
        const t = new Date(start + (Date.now() - start) * speed);
        const s = t.getSeconds();
        const text = message !== undefined && s >= messageWindow[0] && s < messageWindow[1]
            ? message
            : formatHHMM(t);
        if (text !== shown) {
            shown = text;
            display.showText(text);
        }
    };
    tick();
    // check well under the simulated-minute granularity so rollovers land promptly
    return window.setInterval(tick, 250);
}

// "HH:MM": four 3-wide digits + 1-wide colon + 4 spacing columns
export const CLOCK_WHEELS = 4 * 3 + 1 + 4;

// ── Page bootstrap (rynx.html) ────────────────────────────────────────────────

function initPlayground(container: HTMLElement) {
    const NUM_WHEELS = 24; // fits 5 glyphs: 5*4 columns + 4 spacing columns
    const display = new RynxDisplay({ numWheels: NUM_WHEELS, container });

    const input = document.getElementById('rynx-input') as HTMLInputElement | null;
    const showButton = document.getElementById('rynx-show');
    const scrambleButton = document.getElementById('rynx-scramble');
    const clearButton = document.getElementById('rynx-clear');
    const speed = document.getElementById('rynx-speed') as HTMLInputElement | null;

    const show = () => display.showText(input?.value ?? 'RYNX!');
    showButton?.addEventListener('click', show);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') show(); });
    scrambleButton?.addEventListener('click', () => display.scramble());
    clearButton?.addEventListener('click', () => display.setColumns([]));
    speed?.addEventListener('input', () => {
        // slider is "speed", frames-per-step is its inverse
        display.framesPerStep = 21 - Number(speed.value);
    });

    if (input) input.value = 'RYNX!';
    display.showText('RYNX!');
    return display;
}

// Wire a button to record `display` for durationMs, downloading a webm named
// `<name>.webm` when it finishes (same Recorder as the splitflap evals).
function wireRecordButton(buttonId: string, display: RynxDisplay, name: string, durationMs: number) {
    const button = document.getElementById(buttonId) as HTMLButtonElement | null;
    if (!button) return;
    const label = button.textContent;
    button.addEventListener('click', () => {
        if (display.recorder?.isRecording) return;
        button.disabled = true;
        button.textContent = 'Recording…';
        display.recorder = new Recorder(display.renderer);
        display.recorder.start({
            durationMs,
            video: true,
            name,
            onDone: () => {
                button.disabled = false;
                button.textContent = label;
            },
        });
    });
}

function initRynxPage() {
    const playgroundEl = document.getElementById('render');
    if (playgroundEl && document.getElementById('rynx-input')) {
        const display = initPlayground(playgroundEl);
        wireRecordButton('rynx-record', display, 'rynx', 10_000);
        // handy for poking at it from the console
        (window as unknown as { rynx: RynxDisplay }).rynx = display;
    }

    const clockEl = document.getElementById('clock-render');
    if (clockEl) {
        const clock = new RynxDisplay({ numWheels: CLOCK_WHEELS, container: clockEl });
        runClock(clock, 2); // 2× realtime for ease of debugging
        // 35s: the 2× minute rolls every 30 real seconds, so this always catches one
        wireRecordButton('clock-record', clock, 'rynx-clock', 35_000);
        (window as unknown as { rynxClock: RynxDisplay }).rynxClock = clock;
    }

    const messageClockEl = document.getElementById('message-clock-render');
    if (messageClockEl) {
        const message = 'RYNX!';
        // wide enough for both the time and the message
        const numWheels = Math.max(CLOCK_WHEELS, textToColumns(message).length);
        const clock = new RynxDisplay({ numWheels, container: messageClockEl });
        runClock(clock, 2, message); // shows the message from :20 to :40
        // 35s covers a full message cycle (in :20 out :40, every 30 real seconds)
        wireRecordButton('message-clock-record', clock, 'rynx-message-clock', 35_000);
        (window as unknown as { rynxMessageClock: RynxDisplay }).rynxMessageClock = clock;
    }
}

// guard so headless (node) importers of this module don't crash on `document`
if (typeof document !== 'undefined') initRynxPage();
