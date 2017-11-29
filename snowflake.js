// Texture width for simulation
var COMPUTATION_WIDTH = 15;
var COMPUTATION_HEIGHT = 15;

var camera, scene, renderer;

var snowflakeSimulation;
var snowflakeData;
var snowflakeUniforms;

var stats;


texturePassThroughVertexShader = `
	varying vec2 textureCoord;
	void main() {
		textureCoord = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`


snowflakeRenderFragmentShader = `
	uniform sampler2D snowflake;
	varying vec2 textureCoord;

	void main() {
		vec4 cell = texture2D(snowflake, textureCoord);

		gl_FragColor.r = cell.x / 100.0;
		gl_FragColor.g = cell.y;
	}
`


snowflakeComputationFragmentShader = `
	void main()	{
		vec2 cellSize = 1.0 / resolution.xy;
		vec2 uv = gl_FragCoord.xy * cellSize;
		vec4 cell = texture2D(snowflake, uv);
		float d = cell.r; // diffuse (vapor) mass
		float c = cell.g; // crystal (ice) mass
		float b = cell.b; // boundary (water) mass
		float a = cell.a; // attachment (is actually a boolean)

		// Get neighbours
		vec4 topLeft = texture2D(snowflake, uv + vec2(-cellSize.x, cellSize.y));
		vec4 topRight = texture2D(snowflake, uv + vec2(0.0, cellSize.y));
		vec4 right = texture2D(snowflake, uv + vec2(cellSize.x, 0.0));
		vec4 bottomRight = texture2D(snowflake, uv + vec2(cellSize.x, -cellSize.y));
		vec4 bottomLeft = texture2D(snowflake, uv + vec2(0.0, -cellSize.y));
		vec4 left = texture2D(snowflake, uv + vec2(-cellSize.x, 0.0));

		float neighbourCount = topLeft.a + topRight.a + right.a + bottomRight.a + bottomLeft.a + left.a - 6.0*a;
		neighbourCount = max(neighbourCount, 0.0);

		d = ((topLeft.r + topRight.r + right.r + bottomRight.r + bottomLeft.r + left.r + d)/7.0)*(1.0-a) + neighbourCount*d/7.0;

		gl_FragColor = vec4(d, c, b, a);
	}
`


function init() {
    initRenderer();
    initScene();
    initSimulation();
    initStats();
}


function initRenderer() {
    var canvas = document.getElementById("snowflake-canvas");
    renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.width, canvas.height);
}


function initScene() {
    // The size of the snowflake geometry is a little redundant in the current
    // setup because we configure the camera to cover 100% of the geometry
    // regardless of its size.
    var GEOMETRY_WIDTH = 1;
    var GEOMETRY_HEIGHT = 1;

    var geometry = new THREE.PlaneBufferGeometry(GEOMETRY_WIDTH, GEOMETRY_HEIGHT);
    var material = new THREE.ShaderMaterial({
        uniforms: {
            snowflake: {value: null}
        },
        vertexShader: texturePassThroughVertexShader,
        fragmentShader: snowflakeRenderFragmentShader,
    });
    var snowflakeObject = new THREE.Mesh(geometry, material);

    scene = new THREE.Scene();
    scene.add(snowflakeObject);

    camera = new THREE.OrthographicCamera(
        GEOMETRY_WIDTH / - 2,
        GEOMETRY_WIDTH / 2,
        GEOMETRY_HEIGHT / 2,
        GEOMETRY_HEIGHT / - 2,
        1,
        1000
    );
    camera.position.z = 2;

    snowflakeUniforms = material.uniforms;
}


function initSimulation() {
    snowflakeSimulation = new GPUComputationRenderer(COMPUTATION_WIDTH, COMPUTATION_HEIGHT, renderer);
    snowflakeInitialData = getInitialData(snowflakeSimulation);

    snowflakeData = snowflakeSimulation.addVariable(
        "snowflake",
        snowflakeComputationFragmentShader,
        snowflakeInitialData
    );

    snowflakeSimulation.setVariableDependencies(snowflakeData, [snowflakeData]);

    var error = snowflakeSimulation.init();
    if (error !== null) {
        console.error(error);
    }
}


function initStats() {
    stats = new Stats();
    document.body.appendChild(stats.dom);
}


function getInitialData(snowflakeSimulation) {
    var texture = snowflakeSimulation.createTexture();
    var pixels = texture.image.data;
    var width = texture.image.width;
    var height = texture.image.height;

    var centreX = Math.floor(width/2);
    var centreY = Math.floor(height/2);

    // Set all cells to zeros
    for (var p=0; p < pixels.length; p+=4) {
        pixels[p + 0] = 0.0; // d
        pixels[p + 1] = 0.0; // c
        pixels[p + 2] = 0.0; // b
        pixels[p + 3] = 0.0; // a
    }

    // The middle cell is the showflake seed. It is "attached" and has
    // solid crystal mass rather than vapor mass.
    p = (centreY*width+centreX)*4;
    pixels[p + 0] = 0.0; // d
    pixels[p + 1] = 1.0; // c
    pixels[p + 2] = 0.0; // b
    pixels[p + 3] = 1; // a

    // THIS IS TEMPORARY
    // To test the diffusion algorithm we seed one of the cells next to the
    // centre with enough vapour to spread 50 to every cell given enough time.
    p += 4;
    pixels[p + 0] = (width*height-1)*50; // d
    pixels[p + 1] = 0.0; // c
    pixels[p + 2] = 0.0; // b
    pixels[p + 3] = 0.0; // a

    return texture
}


function animate() {
    requestAnimationFrame(animate);

    // Every animation frame we do a single step of the snowflake simulation,
    // copy the data from that into the texture for snowflake object and then
    // render the scene containing the snowflake object
    snowflakeSimulation.compute();
    snowflakeUniforms.snowflake.value = snowflakeSimulation.getCurrentRenderTarget(snowflakeData).texture;
    renderer.render(scene, camera);

    stats.update();
}


init();
requestAnimationFrame(animate);
