import * as THREE from 'three';
// need to figure out what to do for the type defns 
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setAnimationLoop( animate );
document.body.appendChild( renderer.domElement );


const controls = new OrbitControls( camera, renderer.domElement );

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

const ambientLight = new THREE.AmbientLight(0x404040); // Soft white light
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);


const directionalLight2 = new THREE.DirectionalLight(0xffffff, 1);
directionalLight2.position.set(1, 1, -1);
scene.add(directionalLight2);

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
    new THREE.MeshLambertMaterial({ color: 0x0000ff }), // Top → blue
    new THREE.MeshLambertMaterial({ color: 0xff0000 }), // Bottom → red
    new THREE.MeshLambertMaterial({ color: 0x00ff00 })  // Side → green
];

console.log(geometry.groups)

// function triColourDisc(geometry: any) {
//     geometry.computeVertexNormals();
//     let normals = geometry.getAttribute("normal");
// 	var faces = geometry.getAttribute('position').count / 3,
// 			colors  = [],
// 			object  = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial( {vertexColors: true} ));
// 	for( let i=0; i<faces; i++ ){
//         // let t1 = normals.array[i * 3];
//         // let t2 = normals.array[i * 3 + 1];
//         // let t3 = normals.array[i * 3 + 2];
        
//         let nx = normals.getX(i)
//         let ny = normals.getY(i);
//         let nz = normals.getZ(i);
        
//         if (nz > 0.8) {
//             // Top face (blue)
//             colors.push(0, 0, 1);
//             colors.push(0, 0, 1);
//             colors.push(0, 0, 1);
//         } else if (nz < -0.8) {
//             // Bottom face (red)
//             colors.push(1, 0, 0);
//             colors.push(1, 0, 0);
//             colors.push(1, 0, 0);
//         } else {
//             // Side (green)
//             colors.push(0, 1, 0);
//             colors.push(0, 1, 0);
//             colors.push(0, 1, 0);
//         }
				
// 	}
// 	geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ));
// 	return object;
// }


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

const axesHelper = new THREE.AxesHelper( 5 );
scene.add( axesHelper );

setThreeDiscGroups(geometry)
const cube = new THREE.Mesh( geometry, materials );
console.log(geometry.getAttribute("normal"));
// let cube = triColourDisc(geometry)
scene.add( cube );

var vnh = new VertexNormalsHelper( cube, 1, 0xff0000 );
scene.add( vnh );



camera.position.z = 20;

// what's the easiest way to make it two-colours?
// probably some kind of texturing setup...
console.log(geometry.getAttribute("position"))


function animate() {

  cube.rotation.x += 0.01;
//   cube.rotation.y += 0.01;

  renderer.render( scene, camera );

}

animate()
