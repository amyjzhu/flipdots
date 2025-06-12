import * as THREE from 'three';
// need to figure out what to do for the type defns 
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { Sky } from 'three/addons/objects/Sky.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setAnimationLoop( animate );
document.body.appendChild( renderer.domElement );
const controls = new OrbitControls( camera, renderer.domElement );

// skybox
const geometry = new THREE.BoxGeometry(450,450,450);
var materials = [
     new THREE.MeshBasicMaterial({
          map : new THREE.TextureLoader().load('../public/skybox/Daylight Box_Left.bmp'),
          side : THREE.BackSide,
     }),
     new THREE.MeshBasicMaterial({
          map : new THREE.TextureLoader().load('../public/skybox/Daylight Box_Right.bmp'),
          side : THREE.BackSide,
     }),
     new THREE.MeshBasicMaterial({
          map : new THREE.TextureLoader().load('../public/skybox/Daylight Box_Top.bmp'),
          side : THREE.BackSide,
     }),
     new THREE.MeshBasicMaterial({
          map : new THREE.TextureLoader().load('../public/skybox/Daylight Box_Bottom.bmp'),
          side : THREE.BackSide,
     }),
     new THREE.MeshBasicMaterial({
          map : new THREE.TextureLoader().load('../public/skybox/Daylight Box_Back.bmp'),
          side : THREE.BackSide,
     }),
     new THREE.MeshBasicMaterial({
          map : new THREE.TextureLoader().load('../public/skybox/Daylight Box_Front.bmp'),
          side : THREE.BackSide,
     }),
];
const cube = new THREE.Mesh(geometry,materials);

scene.add( cube );

const ambientLight = new THREE.AmbientLight(0x404040); // Soft white light
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);
const directionalLight2 = new THREE.DirectionalLight(0xffffff, 1);
directionalLight2.position.set(1, 1, -1);
scene.add(directionalLight2);



let rowsOfDiscs: THREE.Mesh[][] = []
let idxToUpdate: number[][] = [];

let makeDisc = (x: number, y: number, z: number) => {


    let circleShape = new THREE.Shape();
    circleShape.ellipse(0,0,3,3,0,2*3.14);
    
    const extrudeSettings = {
        steps: 2,
        depth: 0.5,
        bevelEnabled: false
        // bevelEnabled: true,
        // bevelThickness: 0.1,
        // bevelSize: 1,
        // bevelOffset: 0,
        // bevelSegments: 1
    };
    console.log(circleShape.getPoints())
    const geometry = new THREE.ExtrudeGeometry( circleShape, extrudeSettings );
    
    
    // const material1 = new THREE.ShaderMaterial({
    //     uniforms: {
    //         diffuse: { value: new THREE.Color(0xffffff) }
    //     },
    //     vertexShader: `
    //         void main() {
    //             gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                
    //         }`,
    //     fragmentShader: `
    //         uniform vec3 diffuse;
    //         void main() {
    //             gl_FragColor = vec4( diffuse, 1.0 );
    //         }`
    // });
    
    // material1.uniforms.diffuse.value = new THREE.Color(0,1,0);
    
    
    // const geometry = new THREE.BoxGeometry( 1, 1, 1 );
    // const material = new THREE.MeshPhongMaterial( { color: 0x00ff00 } );
    // const material = new THREE.MeshStandardMaterial( { color: 0x00ff00, wireframe: true } );
    const materials = [
        new THREE.MeshLambertMaterial({ color: 0xffabca }), 
        new THREE.MeshLambertMaterial({ color: 0x14a620 }), 
        new THREE.MeshLambertMaterial({ color: 0x000000 })  
    ];
    
    console.log(geometry.groups)
    

    function setThreeDiscGroups(geometry: any) {
        geometry.computeVertexNormals();
        let normals = geometry.getAttribute("normal");
    
        let group1 = geometry.groups[0];
        let group3 = geometry.groups[1];
                
        let group2Start = 0;
        let startingPositive = normals.getZ(0) > 0
        for( let i=0; i<group1.count; i++ ){
            let nz = normals.getZ(i);
            
            if (nz < -0.8 && startingPositive) {
                group2Start = i;
                break;
            } else if (nz > 0.8 && !startingPositive) {
                group2Start = i;
                break;
            } 
                    
        }
    
        geometry.clearGroups();
        geometry.addGroup(group1.start, group2Start - group1.start, 0);
        geometry.addGroup(group2Start, group1.count - group2Start, 1);
        geometry.addGroup(group3.start, group3.count, 2);
        
        // geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ));
    }
    
    setThreeDiscGroups(geometry)
    const cube = new THREE.Mesh( geometry, materials );
    console.log(geometry.getAttribute("normal"));
    // let cube = triColourDisc(geometry)
    
    scene.add(cube);
    cube.position.set(x,y,z);
    return cube;
    
    
    
}

// const axesHelper = new THREE.AxesHelper( 5 );
// scene.add( axesHelper );

// var vnh = new VertexNormalsHelper( cube, 1, 0xff0000 );
// scene.add( vnh );


let SPACING = 7;
let makeRowOfDiscs = (numWide: number, numTall: number) => {

    for (let j = 0; j < numTall; j++) {
        let row = [];
        for (let i = 0; i < numWide; i++) {
            let mesh = makeDisc(i * SPACING - width * SPACING / 2, j * SPACING - height * SPACING / 2, 0);
            row.push(mesh);
        }
        rowsOfDiscs.push(row);
    }

    idxToUpdate = rowsOfDiscs.map(row => row.map((_, i) => i));
}

let width = 5;
let height = 7;
makeRowOfDiscs(width, height);

// where to put the camera? depends... 
// not really sure how to automatically calculate z...
camera.position.z = 60;


let frame1Flips = idxToUpdate = rowsOfDiscs.map((row, idx) => idx % 2 ? [] : row.map((_, i) => i % 2 ? i : -1).filter(i => i != -1));
let frame2Flips = idxToUpdate = rowsOfDiscs.map((row, idx) => idx % 2 ? row.map((_, i) => i % 2 ? -1 : i).filter(i => i != -1): []);
let frame3Flips = idxToUpdate = rowsOfDiscs.map((row, idx) => idx % 2 ? row.map((_, i) => i % 2 ? i : -1).filter(i => i != -1): []);
let frame4Flips = idxToUpdate = rowsOfDiscs.map((row, idx) => idx % 2 ? [] : row.map((_, i) => i % 2 ? -1 : i).filter(i => i != -1));
let setNextToUpdate = (i: number) => { 
    if (i % 4 == 0) {
        idxToUpdate = frame1Flips;
    } else if (i % 4 == 1) {
        idxToUpdate = frame2Flips;
    } else if (i % 4 == 2) {
        idxToUpdate = frame3Flips;
    } else {
        idxToUpdate = frame4Flips;
    }
}

let setNextRipple = (i : number) => {
    if (i % 6 == 0) {
        idxToUpdate = [[0, 1, 2],[],[],[],[],[],[]];
    } else if (i % 6 == 1) {
        idxToUpdate = [[0, 1, 2, 3, 4], [0, 1, 2], [0, 1], [],[],[],[]];
    } else if (i % 6 == 2) {
        idxToUpdate = [[0,1,2,3,4], [0,1,2,3,4], [0,1,2,3], [0,1], [0], [], []];
    } else if (i % 6 == 3) {
        idxToUpdate = [[0,1,2,3,4], [0,1,2,3,4], [0,1,2,3,4], [0,1,2,3],[0,1,2],[0,1],[0]];
    } else if (i % 6 == 4) {
        idxToUpdate = [[0,1,2,3,4], [0,1,2,3,4], [0,1,2,3,4], [0,1,2,3,4],[0,1,2,3,4], [0,1,2,3],[0,1,2]];
    } else if (i % 6 == 5) {
        idxToUpdate = [[0,1,2,3,4], [0,1,2,3,4], [0,1,2,3,4], [0,1,2,3,4],[0,1,2,3,4], [0,1,2,3,4],[0,1,2,3,4]];
    }
}
// what's the easiest way to make it two-colours?
// probably some kind of texturing setup...

// let rotationRate = 0.1;
// let rotationRate = 0.01;
let animationFrameCounter = 0;

let numFramesRotating = 12;
// I need to make a half rotation in 20 frames. How much do I rotate by?
let rotationRate = Math.PI / numFramesRotating;
console.log(rotationRate)
let fullCycleLength = numFramesRotating * 6;
let flipCycles = 0;
function animate() {
    
    for (let row in rowsOfDiscs) {
        for (let idx of idxToUpdate[row]) {
            if (animationFrameCounter < numFramesRotating) {
                rowsOfDiscs[row][idx].rotation.y += rotationRate;
            } // else do nothing 
            
        }
    }

    // how many frames for a full cycle?
    if (animationFrameCounter >= fullCycleLength) {
        animationFrameCounter = 0;
        flipCycles += 1;
        // setNextToUpdate(flipCycles);
        if (flipCycles > 10) {
            setNextToUpdate(flipCycles);
        } else {
            setNextRipple(flipCycles);
        }
    } else {
        animationFrameCounter += 1;
    }

    
  

  renderer.render( scene, camera );

}

animate()
