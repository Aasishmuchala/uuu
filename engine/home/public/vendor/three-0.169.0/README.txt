three.js 0.169.0, for the Map and Needs you pages (PLAN-3D T1). Do not edit; a new version is a new folder.

three.module.min.js  the library, as one minified ES module (the package's build/three.module.min.js).
LICENSE              three.js's MIT licence, as shipped with the package.
jsm/GLTFLoader.js    the glTF loader (the package's examples/jsm/loaders/GLTFLoader.js).
jsm/BufferGeometryUtils.js  geometry helpers the loader and the world use (examples/jsm/utils/BufferGeometryUtils.js).

Source: the three 0.169.0 npm package, taken on 16 November 2026 with the owner's yes. Nothing is fetched at run time.
The two jsm files differ from the package only in their import line: it names '../three.module.min.js' instead of 'three',
so the browser needs no import map.
